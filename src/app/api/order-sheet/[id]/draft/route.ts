import { saveOrderSheetDraft } from "@/services/order-sheet.service";
import { orderSheetDraftSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const PUT = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const parsed = await parseJson(req, orderSheetDraftSchema);
    if (!parsed.ok) return parsed.response;

    try {
      await saveOrderSheetDraft({
        orderId,
        comment: parsed.data.comment,
        items: parsed.data.items,
      });
      return apiOk(null);
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : "Failed to save draft",
        400,
      );
    }
  },
);
