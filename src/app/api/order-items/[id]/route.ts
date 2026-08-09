import { z } from "zod";
import { orderRepository } from "@/repositories";
import { recalculateLineCost } from "@/services/supplier-prices/supplier-price.service";
import { decimalToDb, parseDbDecimal } from "@/utils/decimal";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  finalOrderQty: z.string().regex(/^\d+(\.\d+)?$/),
});

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderItemId = await numericParam(params);
    if (orderItemId === null) return apiError("Invalid order item id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    const item = await orderRepository.getOrderItem(orderItemId);
    if (!item) return apiError("Order item not found", 404);

    const finalQty = parseDbDecimal(parsed.data.finalOrderQty);
    const estimatedLineCost = item.cheapestNetPrice
      ? decimalToDb(
          recalculateLineCost(finalQty, parseDbDecimal(item.cheapestNetPrice))!,
        )
      : null;

    await orderRepository.updateFinalQuantity(
      orderItemId,
      parsed.data.finalOrderQty,
    );

    if (estimatedLineCost !== null) {
      const { db } = await import("@/db");
      const { orderItems } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(orderItems)
        .set({ estimatedLineCost })
        .where(eq(orderItems.id, orderItemId));
    }

    return apiOk(null);
  },
);
