import { orderRepository, storeRepository } from "@/repositories";
import { apiError, apiOk, numericParam, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const orderId = await numericParam(params);
    if (orderId === null) return apiError("Invalid order id");

    const order = await orderRepository.getById(orderId);
    if (!order) return apiError("Order not found", 404);

    const [store, items, supplierPrices, selectedSuppliers] = await Promise.all([
      storeRepository.getById(order.storeId),
      orderRepository.getOrderItemsWithDetails(orderId),
      orderRepository.getItemSupplierPrices(orderId),
      orderRepository.getSelectedSuppliers(orderId),
    ]);

    return apiOk({
      order,
      storeName: store?.name ?? "Store",
      items,
      supplierPrices,
      selectedSuppliers,
    });
  },
);
