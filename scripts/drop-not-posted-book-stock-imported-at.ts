import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  await sql`ALTER TABLE not_posted_deliveries DROP COLUMN IF EXISTS book_stock_imported_at`;
  await sql.end();
  console.log("Dropped not_posted_deliveries.book_stock_imported_at");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
