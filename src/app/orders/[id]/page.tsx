import { notFound } from "next/navigation";
import { OrderDetailPageView } from "@/components/orders/order-detail-page";
import { orderRepository, storeRepository } from "@/repositories";
import { parseRouteId } from "@/utils/parse-route-id";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = parseRouteId(idParam);
  if (id === null) notFound();

  const order = await orderRepository.getById(id);
  if (!order) notFound();

  const [store, items, supplierPrices, selectedSuppliers] = await Promise.all([
    storeRepository.getById(order.storeId),
    orderRepository.getOrderItemsWithDetails(id),
    orderRepository.getItemSupplierPrices(id),
    orderRepository.getSelectedSuppliers(id),
  ]);

  return (
    <OrderDetailPageView
      orderId={id}
      storeName={store?.name ?? "Store"}
      order={order}
      items={items}
      supplierPrices={supplierPrices}
      selectedSuppliers={selectedSuppliers}
    />
  );
}
