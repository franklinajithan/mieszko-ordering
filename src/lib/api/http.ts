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

/** Wrap a route handler with uniform error handling. */
export function route<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
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
