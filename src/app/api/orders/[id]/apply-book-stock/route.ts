import { z } from "zod";
import { applyBookStockUploadToOrder } from "@/services/apply-book-stock-to-order.service";
import {
  apiError,
  apiOk,
  numericParam,
  parseJson,
  route,
} from "@/lib/api/http";

const bodySchema = z.object({
  importedAt: z.string().datetime().optional(),
  bookStockDate: z.string().date().optional(),
});

export const POST = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    return apiOk(
      await applyBookStockUploadToOrder({
        orderId,
        importedAt: parsed.data.importedAt,
        bookStockDate: parsed.data.bookStockDate,
      }),
    );
  },
);
