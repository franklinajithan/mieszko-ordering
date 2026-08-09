import { db } from "@/db";
import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import {
  supplierPriceRepository,
  type SupplierPriceUploadSummary,
} from "@/repositories/supplier-prices";
import { parseAllRows } from "@/parsers/file-parser";
import { supplierPriceImportSchema } from "@/validators/schemas";

export type { SupplierPriceUploadSummary };

export async function listSupplierPriceUploads(): Promise<
  SupplierPriceUploadSummary[]
> {
  return supplierPriceRepository.listUploadSummaries();
}

export async function deleteSupplierPriceUpload(
  supplierId: number,
  importedAtIso: string,
): Promise<void> {
  const importedAt = new Date(importedAtIso);
  if (Number.isNaN(importedAt.getTime())) {
    throw new Error("importedAt must be a valid ISO timestamp");
  }
  await supplierPriceRepository.deleteForSupplierAndImportedAt(
    supplierId,
    importedAt,
  );
}

function normalizeCaseSize(raw: string | undefined): string | null {
  const value = (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return value || null;
}

export async function importSupplierPriceRows(input: {
  supplierId: number;
  referenceColumn: string;
  priceColumn: string;
  caseSizeColumn?: string;
  effectiveDate: string;
  importedAt?: string;
  fileName: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
  };

  const importedAt = input.importedAt
    ? new Date(input.importedAt)
    : new Date();
  if (Number.isNaN(importedAt.getTime())) {
    throw new Error("Select a valid import date and time");
  }

  await db.transaction(async () => {
    const validRows: Array<{
      supplierId: number;
      supplierProductId: number | null;
      supplierCode: string;
      netPrice: string;
      caseSize: string | null;
      effectiveDate: string;
      fileName: string;
      importedAt: Date;
    }> = [];

    for (const row of input.rows) {
      const rowNumber = Number(row.__rowNumber ?? 0);
      const supplierCode = row[input.referenceColumn]?.trim() ?? "";
      const priceRaw = row[input.priceColumn]?.trim() ?? "";
      const caseSize = input.caseSizeColumn
        ? normalizeCaseSize(row[input.caseSizeColumn])
        : null;

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
        supplierId: input.supplierId,
        supplierProductId: supplierProduct.id,
        supplierCode,
        netPrice: decimalToDb(price),
        caseSize,
        effectiveDate: input.effectiveDate,
        fileName: input.fileName,
        importedAt,
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await supplierPriceRepository.insertPrices(validRows);
    }
  });

  return result;
}

export async function importSupplierPricesFromForm(
  formData: FormData,
): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const caseSizeRaw = formData.get("caseSizeColumn");
  const caseSizeColumn =
    typeof caseSizeRaw === "string" && caseSizeRaw.trim()
      ? caseSizeRaw.trim()
      : undefined;

  const importedAtRaw = formData.get("importedAt");
  const importedAt =
    typeof importedAtRaw === "string" && importedAtRaw.trim()
      ? importedAtRaw.trim()
      : undefined;

  const meta = supplierPriceImportSchema.safeParse({
    supplierId: formData.get("supplierId"),
    referenceColumn: formData.get("referenceColumn"),
    priceColumn: formData.get("priceColumn"),
    caseSizeColumn,
    effectiveDate: formData.get("effectiveDate"),
    importedAt,
    fileName: file.name,
  });
  if (!meta.success) throw new Error(meta.error.message);

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);
  return importSupplierPriceRows({ ...meta.data, rows });
}
