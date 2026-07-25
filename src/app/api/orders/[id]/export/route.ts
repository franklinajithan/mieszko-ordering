import { exportOrder } from "@/app/actions";
import { apiError, fromActionResult, numericParam, route } from "@/lib/api/http";

export const POST = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");
    return fromActionResult(await exportOrder({ orderId }));
  },
);
