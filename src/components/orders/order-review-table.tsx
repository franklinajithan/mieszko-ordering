"use client";

import { useMemo, useState, useTransition } from "react";
import { exportHoDairyWithTemplate, exportOrder, updateFinalOrderQuantity } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/utils/format";

type OrderItemRow = {
  item: {
    id: number;
    period1Sales: string;
    period2Sales: string;
    period3Sales: string;
    previousYearSales: string;
    highestSoldQty: string;
    bookStockQty: string;
    receivedNotPostedQty: string;
    futureDeliveryTotalQty: string;
    forecastSalesQty: string;
    shortageQty: string;
    projectedFinalStockQty: string;
    suggestedOrderQty: string;
    finalOrderQty: string;
    priceStatus: string;
    cheapestNetPrice: string | null;
    estimatedLineCost: string | null;
    warning: string | null;
  };
  storeProduct: { storeProductCode: string };
  product: { name: string; department: string };
};

type SupplierPriceRow = {
  price: {
    orderItemId: number;
    netPrice: string | null;
    isCheapest: boolean;
    failureReason: string | null;
  };
  supplier: { id: number; code: string };
};

export function OrderReviewTable({
  orderId,
  items,
  supplierPrices,
  selectedSuppliers,
}: {
  orderId: number;
  items: OrderItemRow[];
  supplierPrices: SupplierPriceRow[];
  selectedSuppliers: Array<{ supplier: { id: number; code: string } }>;
}) {
  const [showCheckOnly, setShowCheckOnly] = useState(false);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      items.filter((row) =>
        showCheckOnly ? !row.item.priceStatus.startsWith("complete") : true,
      ),
    [items, showCheckOnly],
  );

  function onQuantityChange(orderItemId: number, value: string) {
    startTransition(async () => {
      await updateFinalOrderQuantity({ orderItemId, finalOrderQty: value });
    });
  }

  async function downloadExport(base64: string, fileName: string) {
    const blob = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([blob]));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onExport() {
    const result = await exportOrder({ orderId });
    if (!result.success) {
      alert(result.error);
      return;
    }
    await downloadExport(result.data.base64, result.data.fileName);
  }

  async function onExportHoDairyTemplate(formData: FormData) {
    formData.set("orderId", String(orderId));
    const result = await exportHoDairyWithTemplate(formData);
    if (!result.success) {
      alert(result.error);
      return;
    }
    await downloadExport(result.data.base64, result.data.fileName);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showCheckOnly}
            onChange={(e) => setShowCheckOnly(e.target.checked)}
          />
          Show CHECK rows only
        </label>
        <Button type="button" onClick={onExport} disabled={isPending}>
          Export to Excel
        </Button>
        <form action={onExportHoDairyTemplate} className="flex flex-wrap items-center gap-2">
          <FileUploadField
            name="template"
            accept=".xlsx,.xls"
            required
            variant="compact"
            hint="Excel template (.xlsx, .xls)"
            className="min-w-[220px] max-w-sm flex-1"
          />
          <Button type="submit" variant="outline" disabled={isPending}>
            Fill HO Dairy template
          </Button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Product</th>
              <th className="px-2 py-2">Dept</th>
              <th className="px-2 py-2">P1</th>
              <th className="px-2 py-2">P2</th>
              <th className="px-2 py-2">P3</th>
              <th className="px-2 py-2">Prev Yr</th>
              <th className="px-2 py-2">Highest</th>
              <th className="px-2 py-2">Book</th>
              <th className="px-2 py-2">RNP</th>
              <th className="px-2 py-2">Future</th>
              <th className="px-2 py-2">Forecast</th>
              <th className="px-2 py-2">Shortage</th>
              <th className="px-2 py-2">Final stock</th>
              <th className="px-2 py-2">Suggested</th>
              <th className="px-2 py-2">Final qty</th>
              {selectedSuppliers.map(({ supplier }) => (
                <th key={supplier.id} className="px-2 py-2">
                  {supplier.code}
                </th>
              ))}
              <th className="px-2 py-2">Cheapest</th>
              <th className="px-2 py-2">Net price</th>
              <th className="px-2 py-2">Line cost</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Warning</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ item, storeProduct, product }) => {
              const cheapest = supplierPrices.find(
                (p) => p.price.orderItemId === item.id && p.price.isCheapest,
              );
              return (
                <tr key={item.id}>
                  <td className="px-2 py-2">{storeProduct.storeProductCode}</td>
                  <td className="px-2 py-2">{product.name}</td>
                  <td className="px-2 py-2">{product.department}</td>
                  <td className="px-2 py-2">{item.period1Sales}</td>
                  <td className="px-2 py-2">{item.period2Sales}</td>
                  <td className="px-2 py-2">{item.period3Sales}</td>
                  <td className="px-2 py-2">{item.previousYearSales}</td>
                  <td className="px-2 py-2">{item.highestSoldQty}</td>
                  <td className="px-2 py-2">{item.bookStockQty}</td>
                  <td className="px-2 py-2">{item.receivedNotPostedQty}</td>
                  <td className="px-2 py-2">{item.futureDeliveryTotalQty}</td>
                  <td className="px-2 py-2">{item.forecastSalesQty}</td>
                  <td className="px-2 py-2">{item.shortageQty}</td>
                  <td className="px-2 py-2">{item.projectedFinalStockQty}</td>
                  <td className="px-2 py-2">{item.suggestedOrderQty}</td>
                  <td className="px-2 py-2">
                    <Input
                      className="h-8 w-20"
                      defaultValue={item.finalOrderQty}
                      onBlur={(e) => onQuantityChange(item.id, e.target.value)}
                    />
                  </td>
                  {selectedSuppliers.map(({ supplier }) => {
                    const snapshot = supplierPrices.find(
                      (p) =>
                        p.price.orderItemId === item.id &&
                        p.supplier.id === supplier.id,
                    );
                    return (
                      <td key={supplier.id} className="px-2 py-2">
                        {formatMoney(snapshot?.price.netPrice ?? null)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">{cheapest?.supplier.code ?? "—"}</td>
                  <td className="px-2 py-2">{formatMoney(item.cheapestNetPrice)}</td>
                  <td className="px-2 py-2">{formatMoney(item.estimatedLineCost)}</td>
                  <td className="px-2 py-2">
                    <Badge status={item.priceStatus} />
                  </td>
                  <td className="px-2 py-2 text-red-700">{item.warning ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
