import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  await sql`DROP TABLE IF EXISTS order_stock_event_items CASCADE`;
  await sql`DROP TABLE IF EXISTS order_stock_events CASCADE`;
  await sql`DROP TABLE IF EXISTS order_uploads CASCADE`;
  await sql`DROP TABLE IF EXISTS order_sales_periods CASCADE`;
  await sql`DROP TABLE IF EXISTS order_price_suppliers CASCADE`;
  await sql.end();
  console.log("Dropped unused order tables.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
