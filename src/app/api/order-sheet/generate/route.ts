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
    return apiError(
      error instanceof Error ? error.message : "Failed to generate order sheet",
      400,
    );
  }
});
