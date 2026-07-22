import { db } from "@/db";
import type { ImportResult, MappingType, ParsedRow, UploadType } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { orderRepository, productRepository } from "@/repositories/postgres";

export async function processStockUpload(input: {
  orderId: string;
  storeId: string;
  uploadType: UploadType;
  fileName: string;
  mappingType: MappingType;
  referenceColumn: string;
  quantityColumn: string;
  supplierId?: string;
  deliveryDate?: string;
  bookStockDate: string;
  rows: ParsedRow[];
}): Promise<ImportResult & { uploadId: string }> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
  };

  let uploadId = "";

  await db.transaction(async () => {
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
      eventId: string;
      storeProductId: string;
      quantity: string;
    }> = [];

    for (const row of input.rows) {
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
