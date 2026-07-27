import { config } from "dotenv";

config({ path: ".env.local" });
config();
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { stores, suppliers } from "@/db/schema";

const STORE_SEED = [
  { id: 1, name: "Sudbury", code: "SBH", erpType: "glopos" as const },
  { id: 2, name: "Hounslow", code: "HNS", erpType: "msp" as const },
  { id: 3, name: "Perivale", code: "PVL", erpType: "msp" as const },
  { id: 4, name: "Hayes", code: "HYS", erpType: "msp" as const },
  { id: 5, name: "Gravesend", code: "GRV", erpType: "msp" as const },
  { id: 6, name: "Streatham", code: "STR", erpType: "msp" as const },
  { id: 7, name: "Eastham", code: "EAS", erpType: "msp" as const },
  { id: 8, name: "Watford", code: "WTF", erpType: "msp" as const },
  { id: 9, name: "Mitcham", code: "MIT", erpType: "glopos" as const },
] as const;
const SUPPLIER_SEED = [
  { id: 1, name: "Master Media", code: "MM" },
  { id: 2, name: "Spizarnia", code: "SP" },
  { id: 3, name: "Wabar", code: "WAB" },
] as const;

async function seed() {
  const db = getDb();

  await db
    .insert(stores)
    .values(
      STORE_SEED.map((store) => ({
        id: store.id,
        name: store.name,
        code: store.code,
        erpType: store.erpType,
        isActive: true,
      })),
    )
    .onConflictDoNothing({ target: stores.code });

  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('stores', 'id'),
      COALESCE((SELECT MAX(id) FROM stores), 1)
    )
  `);

  await db
    .insert(suppliers)
    .values([
      ...SUPPLIER_SEED.map((supplier) => ({
        name: supplier.name,
        code: supplier.code,
        priceTiePriority: supplier.id,
        isActive: true,
      })),
    ])
    .onConflictDoNothing({ target: suppliers.code });

  console.log(
    `Seeded ${STORE_SEED.length} stores (${STORE_SEED.map((s) => s.code).join(", ")}) and suppliers: MM, SP, WAB`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
