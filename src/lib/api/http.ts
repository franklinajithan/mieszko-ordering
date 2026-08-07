import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import type { ActionResult } from "@/types";

/**
 * Shared helpers for REST route handlers under `src/app/api`.
 *
 * Responses use the same `{ success, data, error }` envelope as the legacy
 * server actions so the migration path to an external (e.g. FastAPI) backend
 * keeps an identical contract. When the backend moves, these route handlers
 * are removed and `NEXT_PUBLIC_API_URL` is pointed at the new service.
 */

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Map an ActionResult to a NextResponse with the same envelope. */
export function fromActionResult<T>(result: ActionResult<T>, okStatus = 200) {
  if (!result.success) return apiError(result.error);
  return apiOk(result.data, okStatus);
}

/** Parse + validate a JSON body against a Zod schema. */
export async function parseJson<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<
  { ok: true; data: T } | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: apiError("Invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: apiError(parsed.error.message) };
  }
  return { ok: true, data: parsed.data };
}

/** Postgres unique_violation (23505), including drizzle "Failed query" wrappers. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; cause?: unknown };
  if (e.code === "23505") return true;
  if (typeof e.message === "string" && /unique|duplicate key/i.test(e.message)) {
    return true;
  }
  return isUniqueViolation(e.cause);
}

/** Wrap a route handler with uniform error handling. */
export function route<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return apiError("A record with this value already exists", 409);
      }
      const message =
        error instanceof Error ? error.message : "Internal server error";
      // Never leak raw SQL / drizzle "Failed query" text to the client.
      if (/failed query|insert into|update "|select /i.test(message)) {
        if (/product_barcodes\.store_product_id does not exist|product_barcodes\.store_id does not exist/i.test(message)) {
          return apiError(
            "Database schema is out of date. Run: npx tsx scripts/migrate-product-barcodes-per-store.ts",
            500,
          );
        }
        if (/relation "wastage" does not exist|relation \"wastage\" does not exist/i.test(message)) {
          return apiError(
            "Database schema is out of date. Run: npx tsx scripts/migrate-wastage-table-rename.ts",
            500,
          );
        }
        return apiError("Something went wrong. Please try again.", 500);
      }
      return apiError(message, 500);
    }
  };
}

/** Resolve the numeric route id from Next 16 async params. */
export async function numericParam(
  params: Promise<{ id: string }>,
): Promise<number | null> {
  const { id } = await params;
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
