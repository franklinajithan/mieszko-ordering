import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

// Read-only operations summary. A missing migration is reported as setup required,
// not silently represented as successful nightly imports.
export async function GET() {
  try {
    const result = await db.execute(sql`
      SELECT s.id AS store_id, s.code AS store_code, s.name AS store_name,
             source.source_type,
             r.status, r.started_at, r.completed_at, r.imported_at,
             r.imported_row_count, r.error_message
      FROM stores s
      CROSS JOIN (VALUES ('normal_sales'), ('rtc'), ('wastage'), ('book_stock')) AS source(source_type)
      LEFT JOIN LATERAL (
        SELECT status, started_at, completed_at, imported_at, imported_row_count, error_message
        FROM data_import_runs
        WHERE store_id = s.id AND source_type = source.source_type
        ORDER BY started_at DESC, id DESC LIMIT 1
      ) r ON TRUE
      WHERE s.is_active = true
      ORDER BY s.name, source.source_type
    `);
    return NextResponse.json({ success: true, configured: true, rows: result.rows, generatedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string }; code?: string }).cause?.code
      ?? (error as { code?: string }).code;
    if (pgCode === "42P01") {
      return NextResponse.json({ success: true, configured: false, rows: [], message: "Apply migrations/manual/2026-10-15-data-import-runs.sql on the office PostgreSQL database." }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Data operations status query failed", error);
    return NextResponse.json({ success: false, error: "Unable to load data import status." }, { status: 500 });
  }
}
