import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { orderRepository } from "@/repositories";

export default async function OrdersPage() {
  const orders = await orderRepository.list();

  return (
    <AppShell
      title="Order History"
      description="Browse past orders and open any order for review or export."
    >
      <div className="mb-4">
        <Link href="/orders/new" className="text-sm font-medium underline">
          Create new order
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Book stock</th>
              <th className="px-4 py-3">Delivery</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(({ order, store }) => (
              <tr key={order.id}>
                <td className="px-4 py-3">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">{store.name}</td>
                <td className="px-4 py-3">{order.bookStockDate}</td>
                <td className="px-4 py-3">{order.clientDeliveryDate}</td>
                <td className="px-4 py-3">
                  <Badge status={order.status === "calculated" ? "complete" : "pending"}>
                    {order.status}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/orders/${order.id}`} className="underline">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
