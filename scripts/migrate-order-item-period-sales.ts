import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });

  await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS period_sales jsonb NOT NULL DEFAULT '[]'::jsonb`;

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_items'
          AND column_name = 'period_1_sales'
      ) THEN
        UPDATE order_items
        SET period_sales = COALESCE((
          SELECT jsonb_agg(value ORDER BY ord)
          FROM (
            SELECT 1 AS ord, jsonb_build_object('periodKey', 'period_1', 'soldQty', COALESCE(period_1_sales::text, '0')) AS value
            UNION ALL
            SELECT 2, jsonb_build_object('periodKey', 'period_2', 'soldQty', COALESCE(period_2_sales::text, '0'))
            UNION ALL
            SELECT 3, jsonb_build_object('periodKey', 'period_3', 'soldQty', COALESCE(period_3_sales::text, '0'))
          ) base
        ), '[]'::jsonb)
          || COALESCE(calculation_breakdown->'orderSheet'->'extraPeriodSales', '[]'::jsonb)
          || CASE
            WHEN previous_year_sales IS NOT NULL AND previous_year_sales::numeric <> 0
            THEN jsonb_build_array(
              jsonb_build_object('periodKey', 'previous_year', 'soldQty', previous_year_sales::text)
            )
            ELSE '[]'::jsonb
          END
        WHERE period_sales = '[]'::jsonb;

        ALTER TABLE order_items DROP COLUMN IF EXISTS period_1_sales;
        ALTER TABLE order_items DROP COLUMN IF EXISTS period_2_sales;
        ALTER TABLE order_items DROP COLUMN IF EXISTS period_3_sales;
        ALTER TABLE order_items DROP COLUMN IF EXISTS previous_year_sales;
      END IF;
    END $$;
  `;

  await sql.end({ timeout: 5 });
  console.log("Moved order item period sales into order_items.period_sales JSON");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
