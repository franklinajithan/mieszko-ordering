import { z } from "zod";
import { recalculateSavedOrder } from "@/services/orders/recalculate-saved-order.service";
import { idSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  supplierIds: z.array(idSchema).min(1),
});

export const PUT = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    return apiOk(await recalculateSavedOrder(orderId,{supplierIds:[...new Set(parsed.data.supplierIds)]}));
  },
);
