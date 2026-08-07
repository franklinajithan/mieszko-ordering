/**
 * Compare GloPOS stock valuation item codes with a store catalog.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/check-book-stock-match-rate.ts <storeId> [path-to-xlsx]
 */
import fs from "fs";
import { parseGloposStockValuationReport } from "../src/parsers/glopos-stock-valuation-parser";
import { productRepository, storeRepository } from "../src/repositories";
import {
  catalogCodeKey,
  indexStoreProducts,
  resolveStoreProduct,
} from "../src/services/book-stock-product-lookup";
import { normalizeProductCode } from "../src/parsers/product-file-parser";

const defaultPath =
  "C:/Users/Ajithan/Downloads/0650_E12 6RH_Stock Valuation (Detail)_20260806_182001.xlsx";

async function main() {
  const storeId = Number(process.argv[2]);
  const filePath = process.argv[3] ?? defaultPath;
  if (!storeId || !Number.isFinite(storeId)) {
    console.error("Usage: npx tsx scripts/check-book-stock-match-rate.ts <storeId> [xlsx]");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const store = await storeRepository.getById(storeId);
  if (!store) {
    console.error("Store not found:", storeId);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const parsed = await parseGloposStockValuationReport(buffer, filePath.split(/[/\\]/).pop()!);
  const refCol = parsed.referenceColumn;
  const fileCodes = [
    ...new Set(
      parsed.rows
        .map((row) => normalizeProductCode(row[refCol] ?? ""))
        .filter(Boolean),
    ),
  ];

  console.log("Store:", store.name, `(id ${store.id}, ERP ${store.erpType})`);
  console.log("File products:", parsed.rows.length, "unique codes:", fileCodes.length);

  const BATCH = 5000;
  const map = new Map<string, { id: number; storeProductCode: string }>();
  for (let i = 0; i < fileCodes.length; i += BATCH) {
    const batch = fileCodes.slice(i, i + BATCH);
    const found = await productRepository.findStoreProductsByCodes(storeId, batch);
    for (const [key, product] of indexStoreProducts(found)) {
      map.set(key, product);
    }
    const missing = batch.filter((c) => !resolveStoreProduct(map, c));
    if (missing.length) {
      const lower = [...new Set(missing.map((c) => catalogCodeKey(c)))];
      const loose = await productRepository.findStoreProductsByLowercaseCodes(storeId, lower);
      for (const [key, product] of indexStoreProducts(loose)) {
        map.set(key, product);
      }
    }
  }

  let matched = 0;
  const unmatchedSamples: string[] = [];
  for (const code of fileCodes) {
    if (resolveStoreProduct(map, code)) matched += 1;
    else if (unmatchedSamples.length < 15) unmatchedSamples.push(code);
  }

  console.log("Would match in DB:", matched, "of", fileCodes.length);
  console.log(
    "Match rate:",
    `${((matched / fileCodes.length) * 100).toFixed(1)}%`,
  );
  if (unmatchedSamples.length) {
    console.log("Sample unmatched codes:", unmatchedSamples.join(", "));
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
