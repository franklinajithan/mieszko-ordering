import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'product_barcodes'
    ORDER BY ordinal_position
  `;
  console.log(cols);
  await sql.end();
}

void main();
