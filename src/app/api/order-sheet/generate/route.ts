import { generateOrderSheet } from "@/services/order-sheet.service";
import { orderSheetGenerateSchema } from "@/validators/schemas";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";

export const maxDuration = 300;

export const POST = route(async (req) => {
  const parsed = await parseJson(req, orderSheetGenerateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await generateOrderSheet(parsed.data);
    return apiOk(result);
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    const dbError = cause && typeof cause === "object" ? cause as {
      code?: string;
      message?: string;
      column_name?: string;
      table_name?: string;
    } : null;
    console.error("[order-sheet/generate] Failed to generate order", {
      error,
      postgresCode: dbError?.code,
      postgresMessage: dbError?.message,
      column: dbError?.column_name,
      table: dbError?.table_name,
    });
    if (dbError?.code === "42703" || dbError?.code === "42P01") {
      return apiError(
        "The ordering database schema is out of date. Apply the pending Drizzle migrations before generating orders.",
        409,
      );
    }
    return apiError(
      "Order generation failed. Check the server terminal for the PostgreSQL error details.",
      500,
    );
  }
});
