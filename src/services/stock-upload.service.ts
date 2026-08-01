import { db } from "@/db";
import type { ImportResult, MappingType, ParsedRow, UploadType, ErpType } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { orderRepository, productRepository } from "@/repositories";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";

export async function processStockUpload(input: {
  orderId: number;
  storeId: number;
  uploadType: UploadType;
  fileName: string;
  mappingType: MappingType;
  referenceColumn: string;
  quantityColumn: string;
  supplierId?: number;
  deliveryDate?: string;
  bookStockDate: string;
  rows: ParsedRow[];
  erpType?: ErpType;
}): Promise<ImportResult & { uploadId: number }> {
  let rows = input.rows;
  let duplicateRows = 0;

  if (input.uploadType === "book_stock" && input.erpType === "glopos") {
    const pivoted = pivotBookStockByReference(
      rows,
      input.referenceColumn,
      input.quantityColumn,
    );
    rows = pivoted.rows;
    duplicateRows = pivoted.duplicateRows;
  }

  const result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows,
    errors: [],
  };

  let uploadId = 0;

  await db.transaction(async () => {
    if (input.uploadType === "book_stock") {
      await orderRepository.clearBookStockEvents(input.orderId);
    }

    const upload = await orderRepository.createUpload({
      orderId: input.orderId,
      uploadType: input.uploadType,
      fileName: input.fileName,
      mappingType: input.mappingType,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
      supplierId: input.supplierId ?? null,
      deliveryDate: input.deliveryDate ?? null,
    });
    uploadId = upload.id;

    const eventDate =
      input.uploadType === "future_delivery"
        ? (input.deliveryDate ?? input.bookStockDate)
        : input.bookStockDate;

    const event = await orderRepository.createStockEvent({
      orderId: input.orderId,
      uploadId: upload.id,
      eventType: input.uploadType,
      eventDate,
      sortOrder: Date.now(),
    });

    const items: Array<{
      eventId: number;
      storeProductId: number;
      quantity: string;
    }> = [];

    for (const row of rows) {
      const rowNumber = Number(row.__rowNumber ?? 0);
      const reference = row[input.referenceColumn]?.trim() ?? "";
      const qtyRaw = row[input.quantityColumn]?.trim() ?? "";

      if (!reference) {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference: null,
          message: "Missing reference",
        });
        continue;
      }

      let qty;
      try {
        qty = toDecimal(qtyRaw);
        if (!qty.isFinite()) throw new Error("invalid");
      } catch {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference,
          message: "Invalid quantity",
        });
        continue;
      }

      let storeProduct = null;
      if (input.mappingType === "store_product_code") {
        storeProduct = await productRepository.findStoreProductByCode(
          input.storeId,
          reference,
        );
      } else if (input.mappingType === "barcode") {
        storeProduct = await productRepository.findStoreProductByBarcode(
          input.storeId,
          reference,
        );
      } else if (input.mappingType === "supplier_code" && input.supplierId) {
        storeProduct = await productRepository.findStoreProductBySupplierCode(
          input.storeId,
          input.supplierId,
          reference,
        );
      }

      if (!storeProduct) {
        result.unmatchedRows += 1;
        result.errors.push({
          rowNumber,
          reference,
          message: "No matching store product",
        });
        continue;
      }

      items.push({
        eventId: event.id,
        storeProductId: storeProduct.id,
        quantity: decimalToDb(qty),
      });
      result.matchedRows += 1;
    }

    if (items.length) {
      await orderRepository.createStockEventItems(items);
    }
  });

  return { ...result, uploadId };
}
