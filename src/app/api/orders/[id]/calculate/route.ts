import { isDemoMode } from "@/lib/runtime-config";
import { calculateOrder } from "@/services/order-calculation.service";
import { apiError, apiOk, numericParam, route } from "@/lib/api/http";

export const POST = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    if (isDemoMode()) {
      const mock = await import("@/repositories/mock");
      await mock.orderRepository.simulateCalculate(orderId);
    } else {
      await calculateOrder(orderId);
    }
    return apiOk(null);
  },
);
