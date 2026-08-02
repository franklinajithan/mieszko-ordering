import { z } from "zod";
import { applyBookStockImportToOrder } from "@/services/apply-book-stock-to-order.service";
import {
  apiError,
  apiOk,
  numericParam,
  parseJson,
  route,
} from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

const bodySchema = z.object({
  importId: idSchema,
});

export const POST = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    return apiOk(
      await applyBookStockImportToOrder({
        orderId,
        importId: parsed.data.importId,
      }),
    );
  },
);
