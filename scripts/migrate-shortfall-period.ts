import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });

  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shortfall_period jsonb`;

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shortfall_start_date'
      ) THEN
        UPDATE orders
        SET shortfall_period = jsonb_build_object(
          'startDate', shortfall_start_date::text,
          'endDate', shortfall_end_date::text
        )
        WHERE shortfall_period IS NULL
          AND (shortfall_start_date IS NOT NULL OR shortfall_end_date IS NOT NULL);

        ALTER TABLE orders DROP COLUMN IF EXISTS shortfall_start_date;
        ALTER TABLE orders DROP COLUMN IF EXISTS shortfall_end_date;
      END IF;
    END $$;
  `;

  await sql.end({ timeout: 5 });
  console.log("Moved shortfall dates into orders.shortfall_period JSON");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
