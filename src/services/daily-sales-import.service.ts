import type { ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { toDecimal, decimalToDb, type Decimal } from "@/utils/decimal";
import { dailySalesRepository, productRepository } from "@/repositories";

export type AggregatedDailySale = {
  reference: string;
  productName: string | null;
  salesDate: string;
  qty: Decimal;
  rowNumber: number;
};

export const DAILY_SALES_IMPORT_BATCH_SIZE = 100;

function isSalesSummaryRow(reference: string): boolean {
  const normalized = reference.replace(/[:\s]+$/g, "").toLowerCase();
  return (
    normalized === "total" ||
    normalized === "grand total" ||
    normalized.endsWith(" - total")
  );
}

export function prepareDailySalesImport(input: {
  productColumn: string;
  quantityColumn: string;
  dateColumn?: string;
  manualSalesDate?: string;
  rows: ParsedRow[];
}): {
  sales: AggregatedDailySale[];
  result: ImportResult;
} {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const aggregated = new Map<string, AggregatedDailySale>();

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = row[input.productColumn]?.trim() ?? "";
    const productName =
      row.__productName?.trim() ??
      row["Product Name"]?.trim() ??
      row.Description?.trim() ??
      row.Name?.trim() ??
      null;
    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
    const salesDate =
      input.manualSalesDate ??
      (input.dateColumn ? row[input.dateColumn]?.trim() : "");

    if (isSalesSummaryRow(reference)) {
      result.totalRows -= 1;
      continue;
    }

    if (!reference) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: null,
        message: "Missing product reference",
      });
      continue;
    }

    if (!salesDate) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference,
        message: "Missing sales date",
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
        message: "Invalid sold quantity",
      });
      continue;
    }

    const dedupeKey = `${reference.toLowerCase()}|${salesDate}`;
    const existing = aggregated.get(dedupeKey);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      result.duplicateRows = (result.duplicateRows ?? 0) + 1;
      continue;
    }

    aggregated.set(dedupeKey, {
      reference,
      productName,
      salesDate,
      qty,
      rowNumber,
    });
  }

  return { sales: [...aggregated.values()], result };
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
