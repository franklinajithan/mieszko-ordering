import { OrdersPageView } from "@/components/orders/orders-page";
import { orderRepository } from "@/repositories";

export default async function OrdersPage() {
  const orders = await orderRepository.list();
  return <OrdersPageView orders={orders} />;
}
