import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { productBarcodes, products, storeProducts } from "../src/db/schema";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const db = createDb();
  const storeId = 1;
  try {
    const catalogRows = await db
      .select({
        barcode: productBarcodes.barcode,
        storeProductId: storeProducts.id,
        storeProductCode: storeProducts.storeProductCode,
        productName: products.name,
      })
      .from(productBarcodes)
      .innerJoin(storeProducts, eq(storeProducts.id, productBarcodes.storeProductId))
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(eq(productBarcodes.storeId, storeId))
      .limit(3);
    console.log("query ok", catalogRows.length, catalogRows[0]);
  } catch (e) {
    console.error("query failed", e);
  }
}

void main();
