/**
 * Renames legacy store_wastage table to wastage (matches src/db/schema.ts).
 * Run: npx tsx scripts/migrate-wastage-table-rename.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('wastage', 'store_wastage')
  `;
  const names = new Set(tables.map((t) => t.table_name));

  if (names.has("wastage") && !names.has("store_wastage")) {
    console.log("wastage table already exists.");
    await sql.end();
    return;
  }

  if (!names.has("store_wastage")) {
    console.error("Neither store_wastage nor wastage found.");
    process.exit(1);
  }

  if (names.has("wastage") && names.has("store_wastage")) {
    console.error("Both wastage and store_wastage exist; manual merge required.");
    process.exit(1);
  }

  console.log("Renaming store_wastage → wastage…");
  await sql`ALTER TABLE store_wastage RENAME TO wastage`;
  await sql`
    ALTER INDEX IF EXISTS store_wastage_store_product_date_unique
    RENAME TO wastage_store_product_date_unique
  `.catch(() => undefined);

  const count = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM wastage`;
  console.log(`Done. wastage rows: ${count[0]!.c}`);
  await sql.end();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
