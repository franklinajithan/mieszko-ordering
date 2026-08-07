import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'product_barcodes'::regclass
  `;
  console.log(constraints);
  const count = await sql`SELECT count(*)::int AS c FROM product_barcodes`;
  console.log("rows", count[0]);
  await sql.end();
}

void main();
