import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import {
  promoRepository,
  promoSalesRepository,
  storeRepository,
} from "@/repositories";
import { parseAllRows } from "@/parsers/file-parser";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importStoreQuantityRows } from "@/services/store-quantity-import.service";
import {
  detectBookStockFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { promoImportSchema } from "@/validators/schemas";

export async function importPromoRows(input: {
  storeId: number;
  promoDate: string;
  mappingType: SalesMappingType;
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

  let importId = 0;
  let result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows,
    errors: [],
  };

  await db.transaction(async () => {
    const promoImport = await promoRepository.createImport({
      storeId: input.storeId,
      promoDate: input.promoDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = promoImport.id;

    result = await importStoreQuantityRows({
      storeId: input.storeId,
      mappingType: input.mappingType,
      productColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
      recordDate: input.promoDate,
      rows,
      upsert: async ({ storeProductId, quantity }) => {
        await promoSalesRepository.upsert({
          storeProductId,
          promoDate: input.promoDate,
          promoQty: quantity,
        });
      },
    });

    result.duplicateRows = (result.duplicateRows ?? 0) + duplicateRows;
    await promoRepository.updateMatchedRows(importId, result.matchedRows);
  });

  return { ...result, importId };
}

export type PromoImportSummary = {
  importId: number;
  fileName: string | null;
  promoDate: string;
  importedAt: Date;
  itemCount: number;
};

export async function listPromoImportsForStore(
  storeId: number,
): Promise<PromoImportSummary[]> {
  const imports = await promoRepository.listForStore(storeId);
  return imports.map((entry) => ({
    importId: entry.id,
    fileName: entry.fileName,
    promoDate: entry.promoDate,
    importedAt: entry.importedAt,
    itemCount: entry.matchedRows ?? 0,
  }));
}

export async function importPromoFromForm(
  formData: FormData,
): Promise<ImportResult & { importId: number }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const meta = promoImportSchema.safeParse({
    storeId: formData.get("storeId"),
    promoDate: formData.get("promoDate"),
    mappingType: formData.get("mappingType") || "store_product_code",
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

  return importPromoRows({
    ...meta.data,
    rows,
    erpType: storeErpType,
  });
}
