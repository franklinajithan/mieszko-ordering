"use client";

import { OrderSheetSection } from "@/components/order-sheet/order-sheet-section";
import type {
  BookStockStatusRow,
  SupplierDataStatusRow,
} from "@/types/orderSheet";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { formatOrderSheetDateTime } from "@/utils/order-sheet-form";

export function OrderSheetStatusPanels({
  bookStockRows,
  stockLoading,
  supplierStatus,
  supplierStatusLoading,
}: {
  bookStockRows: BookStockStatusRow[];
  stockLoading: boolean;
  supplierStatus: SupplierDataStatusRow[];
  supplierStatusLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <OrderSheetSection number={4} title="Book Stock" compact>
        {stockLoading ? (
          <div className="h-12 animate-pulse rounded-lg bg-zinc-100" />
        ) : bookStockRows.length ? (
          <div className="overflow-auto rounded-lg border border-zinc-200">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600">
                <tr>
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2">Uploaded at</th>
                  <th className="px-3 py-2">Book-stock date</th>
                  <th className="px-3 py-2 text-right">Products</th>
                  <th className="px-3 py-2 text-right">Total qty</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookStockRows.map((row) => (
                  <tr key={row.storeId} className="border-t border-zinc-100">
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.storeCode}</span>
                      <span className="ml-2 text-zinc-500">{row.storeName}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {formatOrderSheetDateTime(row.importedAt)}
                    </td>
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {row.bookStockDate ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.available ? row.itemCount.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.available
                        ? formatDecimal(parseDbDecimal(row.totalBookStockQty ?? "0"), 2)
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        row.available ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {row.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Select stores to load saved book stock uploads.
          </p>
        )}
      </OrderSheetSection>

      <OrderSheetSection number={5} title="Supplier Data Status" compact>
        {supplierStatusLoading ? (
          <div className="h-12 animate-pulse rounded-lg bg-zinc-100" />
        ) : supplierStatus.length ? (
          <div className="overflow-auto rounded-lg border border-zinc-200">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600">
                <tr>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Last Updated</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {supplierStatus.map((row) => (
                  <tr key={row.supplierId} className="border-t border-zinc-100">
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.supplierCode}</span>
                      <span className="ml-2 text-zinc-500">{row.supplierName}</span>
                    </td>
                    <td className="px-3 py-2">
                      {formatOrderSheetDateTime(row.lastUpdated)}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold ${supplierStatusClass(
                        row.status,
                      )}`}
                    >
                      {supplierStatusIcon(row.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Select suppliers to view price data status.
          </p>
        )}
      </OrderSheetSection>
    </div>
  );
}

function supplierStatusIcon(status: SupplierDataStatusRow["status"]): string {
  if (status === "current") return "✓";
  if (status === "stale") return "!";
  return "✕";
}

function supplierStatusClass(status: SupplierDataStatusRow["status"]): string {
  if (status === "current") return "text-emerald-700";
  if (status === "stale") return "text-amber-700";
  return "text-red-700";
}
