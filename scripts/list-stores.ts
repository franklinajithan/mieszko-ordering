import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const stores = await sql`SELECT id, name, erp_type FROM stores ORDER BY id`;
  console.log(stores);
  const barcodes = await sql`
    SELECT store_id, count(*)::int AS c FROM product_barcodes GROUP BY store_id ORDER BY store_id
  `;
  console.log("barcodes by store", barcodes);
  await sql.end();
}

void main();
