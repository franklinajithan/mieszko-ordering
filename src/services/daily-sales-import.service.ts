import type { ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { decimalToDb } from "@/utils/decimal";
import { dailySalesRepository, productRepository } from "@/repositories";
import {
  prepareDailySalesImport,
  type AggregatedDailySale,
} from "@/services/daily-sales-import-prepare";

export type { AggregatedDailySale };
export { prepareDailySalesImport };

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
