import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  for (const table of ["store_wastage", "wastage"]) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `;
    console.log(table, cols.map((c) => c.column_name));
  }
  await sql.end();
}

void main();
