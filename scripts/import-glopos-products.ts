import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { eq, sql } from "drizzle-orm";
import {
  dedupeProductRows,
  detectProductFileColumns,
  parseProductFile,
} from "../src/parsers/product-file-parser";
import { getDb } from "../src/db/client";
import {
  productBarcodes,
  products,
  storeProducts,
  stores,
} from "../src/db/schema";

const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function main() {
  const source =
    process.argv[2] ??
    "C:/Users/ShanmugaratnamMathul/Downloads/Document M.xlsx";
  const storeId = Number(process.argv[3] ?? 9);
  const tempPath = path.join(os.tmpdir(), "document-m-mitcham.xlsx");
  fs.copyFileSync(source, tempPath);

  const buf = fs.readFileSync(tempPath);
  console.log("file bytes", buf.length);

  const t0 = Date.now();
  const { headers, rows } = await parseProductFile(buf, "Document M.xlsx");
  console.log("parse ms", Date.now() - t0, "rows", rows.length);

  const cols = detectProductFileColumns(headers);
  if (!cols.codeColumn || !cols.nameColumn) {
    throw new Error("Missing ID or Name columns");
  }

  const { rows: deduped } = dedupeProductRows(
    rows,
    cols.codeColumn,
    cols.barcodeColumn ?? undefined,
  );

  const normalized = deduped
    .map((row) => ({
      productCode: String(row[cols.codeColumn!] ?? "").trim(),
      name: String(row[cols.nameColumn!] ?? "").trim(),
      department: cols.departmentColumn
        ? String(row[cols.departmentColumn] ?? "").trim() || "General"
        : "General",
      barcode: cols.barcodeColumn
        ? String(row[cols.barcodeColumn] ?? "").trim()
        : "",
    }))
    .filter((row) => row.productCode && row.name);

  console.log("normalized", normalized.length);

  const db = getDb();
  const store = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store[0]) throw new Error(`Store ${storeId} not found`);
  console.log("importing for", store[0].name);

  const existing = await db
    .select({
      productId: storeProducts.productId,
      code: storeProducts.storeProductCode,
    })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId));
  const existingByCode = new Map(existing.map((row) => [row.code, row.productId]));

  const toCreate = normalized.filter((row) => !existingByCode.has(row.productCode));
  console.log("to create", toCreate.length, "existing skipped", normalized.length - toCreate.length);

  const barcodeRows = await db
    .select({ barcode: productBarcodes.barcode })
    .from(productBarcodes);
  const knownBarcodes = new Set(barcodeRows.map((row) => row.barcode));

  let created = 0;
  const t1 = Date.now();
  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    const createdProducts = await db
      .insert(products)
      .values(
        batch.map((row) => ({
          name: row.name,
          department: row.department,
          isActive: true,
        })),
      )
      .returning();

    await db
      .insert(storeProducts)
      .values(
        createdProducts.map((product, index) => ({
          storeId,
          productId: product.id,
          storeProductCode: batch[index]!.productCode,
          isActive: true,
        })),
      )
      .onConflictDoUpdate({
        target: [storeProducts.storeId, storeProducts.storeProductCode],
        set: {
          productId: sql`excluded.product_id`,
          isActive: sql`excluded.is_active`,
          updatedAt: new Date(),
        },
      });

    const barcodes = [];
    for (let index = 0; index < batch.length; index += 1) {
      const barcode = batch[index]?.barcode;
      const productId = createdProducts[index]?.id;
      if (!barcode || !productId || knownBarcodes.has(barcode)) continue;
      knownBarcodes.add(barcode);
      barcodes.push({ productId, barcode });
    }
    if (barcodes.length) {
      await db
        .insert(productBarcodes)
        .values(barcodes)
        .onConflictDoNothing({ target: productBarcodes.barcode });
    }

    created += batch.length;
    console.log("batch saved", created, "/", toCreate.length);
  }

  console.log("import ms", Date.now() - t1, "created", created);

  const after = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId));
  console.log("store count after", after[0]?.count ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
