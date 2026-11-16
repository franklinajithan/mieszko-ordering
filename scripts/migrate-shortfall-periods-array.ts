import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });

  await sql`
    UPDATE orders
    SET shortfall_period = jsonb_build_array(shortfall_period)
    WHERE shortfall_period IS NOT NULL
      AND jsonb_typeof(shortfall_period) = 'object'
  `;

  await sql`
    UPDATE orders
    SET shortfall_period = '[]'::jsonb
    WHERE shortfall_period IS NULL
  `;

  await sql`
    ALTER TABLE orders
    ALTER COLUMN shortfall_period SET DEFAULT '[]'::jsonb
  `;
  await sql`ALTER TABLE orders ALTER COLUMN shortfall_period SET NOT NULL`;

  await sql.end({ timeout: 5 });
  console.log("Converted orders.shortfall_period to a JSON array");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
