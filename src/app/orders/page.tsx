import { OrdersPageView } from "@/components/orders/orders-page";
import { listOrders } from "@/lib/api/orders";

export default async function OrdersPage() {
  const orders = await listOrders();
  if (!orders.success) throw new Error(orders.error);
  return <OrdersPageView orders={orders.data} />;
}
