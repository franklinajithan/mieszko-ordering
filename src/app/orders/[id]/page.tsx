import { notFound } from "next/navigation";
import { OrderDetailPageView } from "@/components/orders/order-detail-page";
import { getOrderDetail } from "@/lib/api/orders";
import { parseRouteId } from "@/utils/parse-route-id";
import type { ComponentProps } from "react";
import type { OrderReviewTable } from "@/components/orders/order-review-table";

type ReviewProps = ComponentProps<typeof OrderReviewTable>;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = parseRouteId(idParam);
  if (id === null) notFound();

  const detail = await getOrderDetail(id);
  if (!detail.success) {
    if (detail.error.toLowerCase().includes("not found")) notFound();
    throw new Error(detail.error);
  }

  return (
    <OrderDetailPageView
      orderId={id}
      storeName={detail.data.storeName}
      order={detail.data.order}
      items={detail.data.items as ReviewProps["items"]}
      supplierPrices={detail.data.supplierPrices as ReviewProps["supplierPrices"]}
      selectedSuppliers={
        detail.data.selectedSuppliers as ReviewProps["selectedSuppliers"]
      }
    />
  );
}
