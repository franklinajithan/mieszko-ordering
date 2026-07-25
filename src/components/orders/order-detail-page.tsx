import Link from "next/link";
import type { ComponentProps } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { OrderReviewTable } from "@/components/orders/order-review-table";
import { RecalculateOrderButton } from "@/components/orders/recalculate-order-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ReviewProps = ComponentProps<typeof OrderReviewTable>;

export function OrderDetailPageView({
  orderId,
  storeName,
  order,
  items,
  supplierPrices,
  selectedSuppliers,
}: {
  orderId: number;
  storeName: string;
  order: {
    bookStockDate: string;
    clientDeliveryDate: string;
    status: string;
    notes: string | null;
  };
  items: ReviewProps["items"];
  supplierPrices: ReviewProps["supplierPrices"];
  selectedSuppliers: ReviewProps["selectedSuppliers"];
}) {
  return (
    <AppShell
      title={`Order — ${storeName}`}
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
          <RecalculateOrderButton orderId={orderId} />
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
          orderId={orderId}
          items={items}
          supplierPrices={supplierPrices}
          selectedSuppliers={selectedSuppliers}
        />
      )}
    </AppShell>
  );
}
