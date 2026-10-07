import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });

  await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_quotes jsonb NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE order_item_supplier_prices ADD COLUMN IF NOT EXISTS case_size varchar(100)`;

  await sql.end({ timeout: 5 });
  console.log("Added order_items.supplier_quotes and order_item_supplier_prices.case_size");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
