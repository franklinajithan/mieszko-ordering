import { z } from "zod";
import { orderRepository } from "@/repositories";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  finalOrderQty: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
});

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderItemId = await numericParam(params);
    if (orderItemId === null) return apiError("Invalid order item id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    const item = await orderRepository.getOrderItem(orderItemId);
    if (!item) return apiError("Order item not found", 404);

    await orderRepository.updateFinalQuantity(orderItemId, parsed.data.finalOrderQty);

    return apiOk(null);
  },
);
