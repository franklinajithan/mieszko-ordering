import { db } from "@/db";
import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { supplierPriceRepository } from "@/repositories/postgres";

export async function importSupplierPriceRows(input: {
  supplierId: number;
  referenceColumn: string;
  priceColumn: string;
  effectiveDate: string;
  fileName: string;
  rows: ParsedRow[];
}): Promise<ImportResult & { importId?: number }> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
  };

  let importId: number | undefined;

  await db.transaction(async () => {
    const priceImport = await supplierPriceRepository.createImport({
      supplierId: input.supplierId,
      effectiveDate: input.effectiveDate,
      fileName: input.fileName,
    });
    importId = priceImport.id;

    const validRows: Array<{
      importId: number;
      supplierId: number;
      supplierProductId: number | null;
      supplierCode: string;
      netPrice: string;
      effectiveDate: string;
    }> = [];

    for (const row of input.rows) {
      const rowNumber = Number(row.__rowNumber ?? 0);
      const supplierCode = row[input.referenceColumn]?.trim() ?? "";
      const priceRaw = row[input.priceColumn]?.trim() ?? "";

      if (!supplierCode) {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference: null,
          message: "Missing supplier reference code",
        });
        continue;
      }

      if (!priceRaw) {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference: supplierCode,
          message: "Missing net price",
        });
        continue;
      }

      let price;
      try {
        price = toDecimal(priceRaw);
        if (!price.isFinite() || price.isZero() || price.isNegative()) {
          throw new Error("invalid");
        }
      } catch {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference: supplierCode,
          message: "Invalid net price",
        });
        continue;
      }

      const supplierProduct = await supplierPriceRepository.findSupplierProduct(
        input.supplierId,
        supplierCode,
      );

      if (!supplierProduct) {
        result.unmatchedRows += 1;
        result.errors.push({
          rowNumber,
          reference: supplierCode,
          message: "No matching supplier product mapping",
        });
        continue;
      }

      validRows.push({
        importId: priceImport.id,
        supplierId: input.supplierId,
        supplierProductId: supplierProduct.id,
        supplierCode,
        netPrice: decimalToDb(price),
        effectiveDate: input.effectiveDate,
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await supplierPriceRepository.insertPrices(validRows);
    }
  });

  return { ...result, importId };
}
