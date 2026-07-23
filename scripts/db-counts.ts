import "dotenv/config";
import { getDb } from "../src/db/client";
import { storeProducts, stores } from "../src/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const storeRows = await db.select().from(stores);
  console.log(
    "stores",
    storeRows.map((x) => ({ id: x.id, name: x.name, erp: x.erpType })),
  );
  const counts = await db
    .select({
      storeId: storeProducts.storeId,
      count: sql<number>`count(*)::int`,
    })
    .from(storeProducts)
    .groupBy(storeProducts.storeId);
  console.log("store_products counts", counts);
}

main().catch(console.error);
