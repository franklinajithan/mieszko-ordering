import type { FilePreview, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { decimalToDb } from "@/utils/decimal";
import { dailySalesRepository, productRepository } from "@/repositories";
import { tryParseRetailSalesReport } from "@/parsers/glopos-retail-parser";
import { parseUploadedFile } from "@/parsers/file-parser";
import {
  assertStoreFileErpMatch,
  type ParseImportFileInput,
} from "@/services/import-parse.service";
import {
  prepareDailySalesImport,
  type AggregatedDailySale,
} from "@/services/daily-sales-import-prepare";
import { detectDailySalesFileErpType } from "@/utils/erp-file-validation";

export type { AggregatedDailySale };
export { prepareDailySalesImport };

export type DailySalesParseResult = FilePreview & {
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

/** Inspect a daily-sales upload for UI column mapping (does not persist). */
export async function parseDailySalesImportFile(
  input: ParseImportFileInput,
): Promise<DailySalesParseResult> {
  const retail = await tryParseRetailSalesReport(input.buffer, input.fileName);

  const preview: DailySalesParseResult =
    retail ?
      {
        headers: retail.headers,
        rows: retail.rows.slice(0, 10),
        productColumn: retail.itemCodeColumn,
        quantityColumn: retail.salesQtyColumn,
        manualSalesDate: retail.salesDate ?? undefined,
        periodLabel: retail.periodLabel,
        duplicateRows: retail.duplicateRows,
      }
    : await parseUploadedFile(input.buffer, input.fileName);

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: preview.headers,
    fileName: input.fileName,
    detectFileErpType: detectDailySalesFileErpType,
  });

  return preview;
}

export async function importDailySalesBatch(input: {
  storeId: number;
  mappingType: SalesMappingType;
  sales: AggregatedDailySale[];
  result: ImportResult;
}) {
  const references = [...new Set(input.sales.map((sale) => sale.reference))];
  const storeProductByReference = new Map<string, number>();

  if (input.mappingType === "store_product_code") {
    const products = await productRepository.findStoreProductsByCodes(
      input.storeId,
      references,
    );
    for (const product of products) {
      storeProductByReference.set(product.storeProductCode, product.id);
    }
  } else {
    const products = await productRepository.findStoreProductsByBarcodes(
      input.storeId,
      references,
    );
    for (const product of products) {
      storeProductByReference.set(product.barcode, product.storeProduct.id);
    }
  }

  const rowsToUpsert: Array<{
    storeProductId: number;
    salesDate: string;
    soldQty: string;
  }> = [];

  for (const sale of input.sales) {
    const storeProductId = storeProductByReference.get(sale.reference);
    if (!storeProductId) {
      input.result.unmatchedRows += 1;
      if (input.result.errors.length < 25) {
        input.result.errors.push({
          rowNumber: sale.rowNumber,
          reference: sale.reference,
          message: `No matching store product. Name: ${sale.productName ?? "—"} · Sold qty: ${decimalToDb(sale.qty)}`,
        });
      }
      continue;
    }

    rowsToUpsert.push({
      storeProductId,
      salesDate: sale.salesDate,
      soldQty: decimalToDb(sale.qty),
    });
  }

  await dailySalesRepository.upsertSalesBatch(rowsToUpsert);
  input.result.matchedRows += rowsToUpsert.length;
}

export async function importDailySalesRows(input: {
  storeId: number;
  mappingType: SalesMappingType;
  productColumn: string;
  quantityColumn: string;
  dateColumn?: string;
  manualSalesDate?: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const { sales, result } = prepareDailySalesImport(input);
  await importDailySalesBatch({
    storeId: input.storeId,
    mappingType: input.mappingType,
    sales,
    result,
  });
  return result;
}

export type DailySalesStoreSummary = {
  salesDate: string;
  itemCount: number;
  totalSoldQty: string;
  lastUpdated: string;
};

export async function listDailySalesSummariesForStore(
  storeId: number,
): Promise<DailySalesStoreSummary[]> {
  const rows = await dailySalesRepository.listDateSummariesForStore(storeId);
  return rows.map((row) => ({
    salesDate: row.salesDate,
    itemCount: row.itemCount,
    totalSoldQty: String(row.totalSoldQty),
    lastUpdated: String(row.lastUpdated),
  }));
}

export async function deleteDailySalesForStoreDate(
  storeId: number,
  salesDate: string,
): Promise<void> {
  await dailySalesRepository.deleteForStoreAndDate(storeId, salesDate);
}
