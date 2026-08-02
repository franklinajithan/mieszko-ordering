import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import {
  bookStockRepository,
  productRepository,
  storeRepository,
} from "@/repositories";
import { parseAllRows } from "@/parsers/file-parser";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import {
  detectBookStockFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { bookStockImportSchema } from "@/validators/schemas";

export async function importBookStockRows(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  rows: ParsedRow[];
  erpType?: ErpType;
}): Promise<ImportResult & { importId: number }> {
  let rows = input.rows;
  let duplicateRows = 0;

  if (input.erpType === "glopos") {
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

  let importId = 0;

  await db.transaction(async () => {
    const bookStockImport = await bookStockRepository.createImport({
      storeId: input.storeId,
      bookStockDate: input.bookStockDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = bookStockImport.id;

    const validRows: Array<{
      importId: number;
      storeProductId: number;
      storeProductCode: string;
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
          message: "Missing product code",
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

      const storeProduct = await productRepository.findStoreProductByCode(
        input.storeId,
        reference,
      );

      if (!storeProduct) {
        result.unmatchedRows += 1;
        result.errors.push({
          rowNumber,
          reference,
          message: "No matching store product",
        });
        continue;
      }

      validRows.push({
        importId: bookStockImport.id,
        storeProductId: storeProduct.id,
        storeProductCode: reference,
        quantity: decimalToDb(qty),
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await bookStockRepository.insertItems(validRows);
    }
  });

  return { ...result, importId };
}

export async function importBookStockFromForm(
  formData: FormData,
): Promise<ImportResult & { importId: number }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const meta = bookStockImportSchema.safeParse({
    storeId: formData.get("storeId"),
    bookStockDate: formData.get("bookStockDate"),
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });
  if (!meta.success) throw new Error(meta.error.message);

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) throw new Error("Store not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseAllRows(buffer, file.name);
  const storeErpType = resolveStoreErpType(store.erpType);
  const mismatch = validateErpFileMatch(
    detectBookStockFileErpType(headers),
    storeErpType,
  );
  if (mismatch) throw new Error(mismatch);

  return importBookStockRows({ ...meta.data, rows, erpType: storeErpType });
}
