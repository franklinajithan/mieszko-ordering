import { NextResponse } from "next/server";
import {getImportStatusRows} from "@/services/operations/import-status.service";

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

// Read-only operations summary. A missing migration is reported as setup required,
// not silently represented as successful nightly imports.
export async function GET() {
  try {
    const result = await getImportStatusRows();
    return NextResponse.json({ success: true, configured: true, rows: result, generatedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const pgCode = postgresErrorCode(error);
    if (pgCode === "42P01") {
      return NextResponse.json({ success: true, configured: false, rows: [], message: "Apply migrations/manual/2026-10-15-data-import-runs.sql on the office PostgreSQL database." }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Data operations status query failed", error);
    return NextResponse.json({ success: false, error: "Unable to load data import status." }, { status: 500 });
  }
}
