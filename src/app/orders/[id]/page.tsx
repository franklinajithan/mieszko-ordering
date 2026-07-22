import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OrderReviewTable } from "@/components/orders/order-review-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { calculateOrderAction } from "@/app/actions";
import { orderRepository, storeRepository } from "@/repositories";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await orderRepository.getById(id);
  if (!order) notFound();

  const [store, items, supplierPrices, selectedSuppliers] = await Promise.all([
    storeRepository.getById(order.storeId),
    orderRepository.getOrderItemsWithDetails(id),
    orderRepository.getItemSupplierPrices(id),
    orderRepository.getSelectedSuppliers(id),
  ]);

  async function recalculate() {
    "use server";
    await calculateOrderAction({ orderId: id });
  }

  return (
    <AppShell
      title={`Order — ${store?.name ?? "Store"}`}
      description="Review calculated quantities, supplier prices, and export to Excel."
    >
      <div className="mb-6 space-y-2 rounded-xl border bg-white p-4 text-sm">
        <div className="flex flex-wrap gap-4">
          <span>Book stock: {order.bookStockDate}</span>
          <span>Delivery: {order.clientDeliveryDate}</span>
          <Badge status={order.status === "calculated" ? "complete" : "pending"}>
            {order.status}
          </Badge>
        </div>
        {order.notes ? <p className="text-zinc-600">{order.notes}</p> : null}
        <div className="flex gap-3">
          <form action={recalculate}>
            <Button type="submit" variant="outline">
              Recalculate
            </Button>
          </form>
          <Link href="/orders/new">
            <Button variant="ghost" type="button">
              New order
            </Button>
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">
          No calculated items yet. Complete the order wizard and run calculation.
        </p>
      ) : (
        <OrderReviewTable
          orderId={id}
          items={items}
          supplierPrices={supplierPrices}
          selectedSuppliers={selectedSuppliers}
        />
      )}
    </AppShell>
  );
}
