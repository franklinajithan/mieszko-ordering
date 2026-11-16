import { exportOrderDownload } from "@/services/orders/order-export.service";
import { apiError, apiOk, numericParam, route } from "@/lib/api/http";

export const POST = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");
    return apiOk(await exportOrderDownload(orderId));
  },
);
