"use client";

import { useState } from "react";
import { FutureDeliveriesForm } from "@/components/book-stock/future-deliveries-form";
import { NotPostedDeliveryForm } from "@/components/book-stock/not-posted-delivery-form";
import { OrderSheetSection } from "@/components/order-sheet/order-sheet-section";
import { Button } from "@/components/ui/button";
import type {
  BookStockStatusRow,
  SupplierDataStatusRow,
} from "@/types/orderSheet";
import type { Supplier } from "@/types/supplier";
import { cn } from "@/utils/cn";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { formatOrderSheetDateTime } from "@/utils/order-sheet-form";

export function OrderSheetStatusPanels({
  bookStockRows,
  stockLoading,
  supplierStatus,
  supplierStatusLoading,
  onNotPostedChanged,
  suppliers,
}: {
  bookStockRows: BookStockStatusRow[];
  stockLoading: boolean;
  supplierStatus: SupplierDataStatusRow[];
  supplierStatusLoading: boolean;
  onNotPostedChanged?: () => void;
  suppliers: Supplier[];
}) {
  const [uploadStoreId, setUploadStoreId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <OrderSheetSection number={4} title="Book Stock" compact>
        <p className="text-xs text-zinc-500">
          Not-posted and future delivery files are optional. Those quantities
          are added to book stock for that store.
        </p>
        {stockLoading && bookStockRows.length ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-600" />
          </div>
        ) : null}
        {stockLoading && !bookStockRows.length ? (
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
                  <th className="px-3 py-2 text-right">Not posted</th>
                  <th className="px-3 py-2 text-right">Future</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Deliveries</th>
                </tr>
              </thead>
              <tbody>
                {bookStockRows.map((row) => {
                  const fileCount = row.notPostedFileCount ?? 0;
                  const notPostedQty = row.notPostedQty ?? "0";
                  const futureFileCount = row.futureFileCount ?? 0;
                  const futureQty = row.futureQty ?? "0";
                  const open = uploadStoreId === row.storeId;
                  return (
                    <StoreBookStockRows
                      key={row.storeId}
                      row={row}
                      fileCount={fileCount}
                      notPostedQty={notPostedQty}
                      futureFileCount={futureFileCount}
                      futureQty={futureQty}
                      open={open}
                      onToggle={() =>
                        setUploadStoreId(open ? null : row.storeId)
                      }
                      onNotPostedChanged={onNotPostedChanged}
                      suppliers={suppliers}
                    />
                  );
                })}
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

function StoreBookStockRows({
  row,
  fileCount,
  notPostedQty,
  futureFileCount,
  futureQty,
  open,
  onToggle,
  onNotPostedChanged,
  suppliers,
}: {
  row: BookStockStatusRow;
  fileCount: number;
  notPostedQty: string;
  futureFileCount: number;
  futureQty: string;
  open: boolean;
  onToggle: () => void;
  onNotPostedChanged?: () => void;
  suppliers: Supplier[];
}) {
  const [deliveryTab, setDeliveryTab] = useState<"not-posted" | "future">(
    "not-posted",
  );
  return (
    <>
      <tr className="border-t border-zinc-100">
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
        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
          {fileCount ? (
            <span>
              {formatDecimal(parseDbDecimal(notPostedQty), 2)}
              <span className="ml-1 text-xs text-zinc-500">
                · {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
            </span>
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
          {futureFileCount ? (
            <span>
              {formatDecimal(parseDbDecimal(futureQty), 2)}
              <span className="ml-1 text-xs text-zinc-500">
                · {futureFileCount} file{futureFileCount === 1 ? "" : "s"}
              </span>
            </span>
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </td>
        <td
          className={`px-3 py-2 font-medium ${
            row.available ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {row.message}
        </td>
        <td className="px-3 py-2 text-right">
          <Button type="button" variant="outline" size="sm" onClick={onToggle}>
            {open ? "Close" : fileCount ? "Manage files" : "Add files"}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-zinc-100 bg-zinc-50/80">
          <td colSpan={9} className="px-3 py-3">
            <div
              className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-200 bg-white"
              role="tablist"
              aria-label="Delivery upload type"
            >
              <button
                type="button"
                role="tab"
                aria-selected={deliveryTab === "not-posted"}
                onClick={() => setDeliveryTab("not-posted")}
                className={cn(
                  "border-b-2 px-4 py-3 text-left transition-colors",
                  deliveryTab === "not-posted"
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
                )}
              >
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    deliveryTab === "not-posted" ? "text-emerald-900" : "text-zinc-700",
                  )}
                >
                  Not posted
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                  Upload for this generate. Not reused from saved files.
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={deliveryTab === "future"}
                onClick={() => setDeliveryTab("future")}
                className={cn(
                  "border-b-2 border-l border-l-zinc-200 px-4 py-3 text-left transition-colors",
                  deliveryTab === "future"
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
                )}
              >
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    deliveryTab === "future" ? "text-emerald-900" : "text-zinc-700",
                  )}
                >
                  Future deliveries
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                  Due-in stock from OCS, an order, or an invoice.
                </span>
              </button>
            </div>
            {deliveryTab === "not-posted" ? (
              <NotPostedDeliveryForm
                storeId={row.storeId}
                storeName={row.storeName}
                embedded
                onChanged={onNotPostedChanged}
              />
            ) : (
              <FutureDeliveriesForm
                storeId={row.storeId}
                storeName={row.storeName}
                suppliers={suppliers}
                embedded
                onChanged={onNotPostedChanged}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
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
