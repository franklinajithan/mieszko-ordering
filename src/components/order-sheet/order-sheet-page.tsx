"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  exportOrder,
  generateOrderSheet,
  getOrderSheetSalesDataStatus,
  listBookStockImports,
  getOrderSheetSupplierStatus,
  saveOrderSheetDraft,
} from "@/lib/api";
import type { BookStockUploadSummary } from "@/lib/api/book-stock";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { OrderSheetResultsTable } from "@/components/order-sheet/order-sheet-results-table";
import { OrderSheetPanel, OrderSheetSection } from "@/components/order-sheet/order-sheet-section";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { DepartmentOption } from "@/types/department";
import type {
  ComparisonPeriod,
  OrderSheetFormState,
  OrderSheetItem,
  OrderSheetResult,
  SalesDataStatusRow,
  SoldQtyMethod,
  SupplierDataStatusRow,
} from "@/types/orderSheet";
import { diffDaysInclusive, formatDaySalesLabel, listDatesInclusive, MAX_DAY_BY_SALES_DAYS } from "@/utils/orderSheetCalculations";

type Store = { id: number; name: string; code: string };
type Supplier = { id: number; code: string; name: string; isActive: boolean };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextComparisonPeriodId(existing: ComparisonPeriod[]): string {
  const max = existing.reduce((acc, period) => {
    const match = period.id.match(/^comparison-period-(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `comparison-period-${max + 1}`;
}

function defaultComparisonPeriods(): ComparisonPeriod[] {
  const periods: ComparisonPeriod[] = [];
  for (let index = 2; index >= 0; index -= 1) {
    const end = new Date();
    end.setDate(end.getDate() - index * 7 - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    periods.push({
      id: `comparison-period-${periods.length + 1}`,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
  }
  return periods;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type BookStockStoreRow = {
  storeId: number;
  storeCode: string;
  storeName: string;
  latest: BookStockUploadSummary | null;
};

function mapBookStockRows(
  storeIds: number[],
  stores: Store[],
  uploadsByStore: Map<number, BookStockUploadSummary[]>,
): BookStockStoreRow[] {
  return storeIds.map((storeId) => {
    const store = stores.find((entry) => entry.id === storeId);
    const uploads = uploadsByStore.get(storeId) ?? [];
    return {
      storeId,
      storeCode: store?.code ?? "—",
      storeName: store?.name ?? "Unknown",
      latest: uploads[0] ?? null,
    };
  });
}

function statusIcon(status: SupplierDataStatusRow["status"]): string {
  if (status === "current") return "✓";
  if (status === "stale") return "!";
  return "✕";
}

function statusClass(status: SupplierDataStatusRow["status"]): string {
  if (status === "current") return "text-emerald-700";
  if (status === "stale") return "text-amber-700";
  return "text-red-700";
}

const initialForm = (): OrderSheetFormState => ({
  storeIds: [],
  orderDate: todayIso(),
  deliveryDate: addDaysIso(todayIso(), 7),
  supplierIds: [],
  departmentIds: [],
  comparisonPeriods: defaultComparisonPeriods(),
  includeWastage: true,
  includeRtc: true,
  shortfallStartDate: todayIso(),
  shortfallEndDate: addDaysIso(todayIso(), 6),
  soldQtyMethod: "average",
  comment: "",
  dayBySalesRequired: false,
  dayBySalesStartDate: addDaysIso(todayIso(), -6),
  dayBySalesEndDate: todayIso(),
});

export function OrderSheetPage({
  stores,
  suppliers,
  departments,
}: {
  stores: Store[];
  suppliers: Supplier[];
  departments: DepartmentOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<OrderSheetFormState>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [result, setResult] = useState<OrderSheetResult | null>(null);
  const [items, setItems] = useState<OrderSheetItem[]>([]);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [bookStockRows, setBookStockRows] = useState<BookStockStoreRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [supplierStatus, setSupplierStatus] = useState<SupplierDataStatusRow[]>([]);
  const [supplierStatusLoading, setSupplierStatusLoading] = useState(false);
  const [salesDataRows, setSalesDataRows] = useState<SalesDataStatusRow[]>([]);
  const [salesDataLoading, setSalesDataLoading] = useState(false);

  const showStoreInSalesGrid = form.storeIds.length > 1;

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );

  useEffect(() => {
    if (form.storeIds.length) return;
    if (stores.length) {
      setForm((current) => ({ ...current, storeIds: stores.map((store) => store.id) }));
    }
  }, [stores, form.storeIds.length]);

  useEffect(() => {
    if (form.supplierIds.length) return;
    const defaults = activeSuppliers
      .filter((supplier) => ["MM", "SP", "WAB", "ADM"].includes(supplier.code))
      .map((supplier) => supplier.id);
    if (defaults.length) {
      setForm((current) => ({ ...current, supplierIds: defaults }));
    }
  }, [activeSuppliers, form.supplierIds.length]);

  const shortfallDays = diffDaysInclusive(form.shortfallStartDate, form.shortfallEndDate);

  const dayBySalesDates = useMemo(() => {
    if (!form.dayBySalesRequired) return [];
    if (!form.dayBySalesStartDate || !form.dayBySalesEndDate) return [];
    if (form.dayBySalesEndDate < form.dayBySalesStartDate) return [];
    return listDatesInclusive(form.dayBySalesStartDate, form.dayBySalesEndDate);
  }, [form.dayBySalesRequired, form.dayBySalesStartDate, form.dayBySalesEndDate]);

  useEffect(() => {
    if (!form.storeIds.length) {
      setBookStockRows([]);
      return;
    }
    setStockLoading(true);
    void Promise.all(
      form.storeIds.map(async (storeId) => {
        const response = await listBookStockImports(storeId);
        return [storeId, response.success ? response.data : []] as const;
      }),
    )
      .then((entries) => {
        const uploadsByStore = new Map(entries);
        setBookStockRows(mapBookStockRows(form.storeIds, stores, uploadsByStore));
      })
      .finally(() => setStockLoading(false));
  }, [form.storeIds, stores]);

  useEffect(() => {
    if (!form.supplierIds.length) {
      setSupplierStatus([]);
      return;
    }
    setSupplierStatusLoading(true);
    void getOrderSheetSupplierStatus(form.supplierIds)
      .then((response) => {
        if (response.success) setSupplierStatus(response.data);
      })
      .finally(() => setSupplierStatusLoading(false));
  }, [form.supplierIds]);

  useEffect(() => {
    if (
      !form.dayBySalesRequired ||
      !form.storeIds.length ||
      !form.dayBySalesStartDate ||
      !form.dayBySalesEndDate ||
      form.dayBySalesEndDate < form.dayBySalesStartDate
    ) {
      setSalesDataRows([]);
      return;
    }

    setSalesDataLoading(true);
    void getOrderSheetSalesDataStatus({
      storeIds: form.storeIds,
      startDate: form.dayBySalesStartDate,
      endDate: form.dayBySalesEndDate,
    })
      .then((response) => {
        if (response.success) setSalesDataRows(response.data);
        else setSalesDataRows([]);
      })
      .finally(() => setSalesDataLoading(false));
  }, [
    form.dayBySalesRequired,
    form.storeIds,
    form.dayBySalesStartDate,
    form.dayBySalesEndDate,
  ]);

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!form.storeIds.length) errors.storeIds = "Select at least one store";
    if (!form.orderDate) errors.orderDate = "Order date is required";
    if (!form.deliveryDate) errors.deliveryDate = "Delivery date is required";
    if (form.deliveryDate < form.orderDate) {
      errors.deliveryDate = "Delivery date cannot be earlier than order date";
    }
    if (!form.supplierIds.length) errors.supplierIds = "Select at least one supplier";
    if (!form.departmentIds.length) errors.departmentIds = "Select at least one department";
    if (!form.comparisonPeriods.length) {
      errors.comparisonPeriods = "Add at least one comparison period";
    }
    for (const [index, period] of form.comparisonPeriods.entries()) {
      if (period.endDate < period.startDate) {
        errors[`period-${index}`] = "End date cannot be before start date";
      }
    }
    if (form.shortfallEndDate < form.shortfallStartDate) {
      errors.shortfallEndDate = "End date cannot be before start date";
    }
    if (form.dayBySalesRequired) {
      if (!form.dayBySalesStartDate) {
        errors.dayBySalesStartDate = "Start date is required";
      }
      if (!form.dayBySalesEndDate) {
        errors.dayBySalesEndDate = "End date is required";
      }
      if (
        form.dayBySalesStartDate &&
        form.dayBySalesEndDate &&
        form.dayBySalesEndDate < form.dayBySalesStartDate
      ) {
        errors.dayBySalesEndDate = "End date cannot be before start date";
      }
      if (dayBySalesDates.length > MAX_DAY_BY_SALES_DAYS) {
        errors.dayBySalesEndDate = `Range cannot exceed ${MAX_DAY_BY_SALES_DAYS} days`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onGenerate() {
    setError(null);
    if (!validateForm() || !form.storeIds.length) return;

    setGenerating(true);
    try {
      const primaryBookStock = bookStockRows.find((row) => row.latest)?.latest;
      const response = await generateOrderSheet({
        orderId: orderId ?? undefined,
        storeIds: form.storeIds,
        orderDate: form.orderDate,
        deliveryDate: form.deliveryDate,
        bookStockDate: primaryBookStock?.bookStockDate ?? undefined,
        supplierIds: form.supplierIds,
        departmentIds: form.departmentIds,
        comparisonPeriods: form.comparisonPeriods.map((period) => ({
          startDate: period.startDate,
          endDate: period.endDate,
        })),
        includeWastage: form.includeWastage,
        includeRtc: form.includeRtc,
        shortfallStartDate: form.shortfallStartDate,
        shortfallEndDate: form.shortfallEndDate,
        soldQtyMethod: form.soldQtyMethod,
        comment: form.comment,
        dayBySalesRequired: form.dayBySalesRequired,
        dayBySalesStartDate: form.dayBySalesRequired ? form.dayBySalesStartDate : undefined,
        dayBySalesEndDate: form.dayBySalesRequired ? form.dayBySalesEndDate : undefined,
      });

      if (!response.success) {
        setError(response.error);
        return;
      }

      setResult(response.data);
      setItems(response.data.items);
      setOrderId(response.data.orderId);
      if (response.data.bookStockStatus.length) {
        setBookStockRows(
          response.data.bookStockStatus.map((row) => ({
            storeId: row.storeId,
            storeCode: row.storeCode,
            storeName: row.storeName,
            latest: row.available
              ? {
                  bookStockDate: row.bookStockDate!,
                  importedAt: row.importedAt!,
                  itemCount: row.itemCount,
                  totalBookStockQty: row.totalBookStockQty ?? "0",
                }
              : null,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate order sheet");
    } finally {
      setGenerating(false);
    }
  }

  async function onSaveDraft() {
    if (!orderId) {
      setError("Generate the order sheet before saving a draft.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await saveOrderSheetDraft({
      orderId,
      comment: form.comment,
      items: items.map((item) => ({
        orderItemId: item.orderItemId,
        orderQty: item.orderQty,
        selected: item.selected,
      })),
    });
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
  }

  async function onExport() {
    if (!orderId) return;
    const response = await exportOrder({ orderId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const blob = Uint8Array.from(atob(response.data.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([blob]));
    const link = document.createElement("a");
    link.href = url;
    link.download = response.data.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function onClearAll() {
    setForm(initialForm());
    setResult(null);
    setItems([]);
    setOrderId(null);
    setBookStockRows([]);
    setError(null);
    setFieldErrors({});
    setConfirmClear(false);
  }

  function updatePeriod(id: string, patch: Partial<ComparisonPeriod>) {
    setForm((current) => ({
      ...current,
      comparisonPeriods: current.comparisonPeriods.map((period) =>
        period.id === id ? { ...period, ...patch } : period,
      ),
    }));
  }

  function addPeriod() {
    setForm((current) => ({
      ...current,
      comparisonPeriods: [
        ...current.comparisonPeriods,
        {
          id: nextComparisonPeriodId(current.comparisonPeriods),
          startDate: addDaysIso(todayIso(), -7),
          endDate: addDaysIso(todayIso(), -1),
        },
      ],
    }));
  }

  function removePeriod(id: string) {
    setForm((current) => ({
      ...current,
      comparisonPeriods: current.comparisonPeriods.filter((period) => period.id !== id),
    }));
  }

  return (
    <div className="space-y-5 pb-24">
      <OrderSheetPanel className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <OrderSheetSection number={1} title="Order Information" compact>
            <div className="space-y-4">
              <SearchableMultiSelect
                label="Stores"
                placeholder="Select stores"
                required
                options={stores.map((store) => ({
                  id: store.id,
                  label: store.code,
                  hint: store.name,
                }))}
                selected={form.storeIds}
                onChange={(storeIds) => setForm((current) => ({ ...current, storeIds }))}
                error={fieldErrors.storeIds ?? null}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Order Date *</Label>
                  <DateField
                    name="orderDate"
                    className="mt-1.5"
                    value={form.orderDate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, orderDate: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Delivery Date *</Label>
                  <DateField
                    name="deliveryDate"
                    className="mt-1.5"
                    value={form.deliveryDate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, deliveryDate: event.target.value }))
                    }
                  />
                  {fieldErrors.deliveryDate ? (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.deliveryDate}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </OrderSheetSection>

          <OrderSheetSection number={2} title="Suppliers & Departments" compact>
            <div className="grid gap-4">
              <SearchableMultiSelect
                label="Suppliers"
                placeholder="Select suppliers"
                required
                options={activeSuppliers.map((supplier) => ({
                  id: supplier.id,
                  label: supplier.code,
                  hint: supplier.name,
                }))}
                selected={form.supplierIds}
                onChange={(supplierIds) =>
                  setForm((current) => ({ ...current, supplierIds }))
                }
                error={fieldErrors.supplierIds ?? null}
              />
              <SearchableMultiSelect
                label="Departments"
                placeholder="Select departments"
                required
                options={departments.map((department) => ({
                  id: department.id,
                  label: department.name,
                }))}
                selected={form.departmentIds}
                onChange={(departmentIds) =>
                  setForm((current) => ({ ...current, departmentIds }))
                }
                error={fieldErrors.departmentIds ?? null}
              />
            </div>
          </OrderSheetSection>
        </div>

        <div className="border-t border-zinc-100" />

        <div className="grid gap-6 lg:grid-cols-2">
          <OrderSheetSection number={3} title="Options & Shortfall" compact>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.includeWastage}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, includeWastage: event.target.checked }))
                    }
                  />
                  Include Wastage
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.includeRtc}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, includeRtc: event.target.checked }))
                    }
                  />
                  Include RTC
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.dayBySalesRequired}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dayBySalesRequired: event.target.checked,
                      }))
                    }
                  />
                  Day-by-sales required
                </label>
              </div>
              {form.dayBySalesRequired ? (
                <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-4">
                  <Label>Day-by-sales period</Label>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-zinc-500">Start date</Label>
                      <DateField
                        name="dayBySalesStartDate"
                        className="mt-1"
                        value={form.dayBySalesStartDate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            dayBySalesStartDate: event.target.value,
                          }))
                        }
                      />
                      {fieldErrors.dayBySalesStartDate ? (
                        <p className="mt-1 text-xs text-red-600">
                          {fieldErrors.dayBySalesStartDate}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <Label className="text-xs text-zinc-500">End date</Label>
                      <DateField
                        name="dayBySalesEndDate"
                        className="mt-1"
                        value={form.dayBySalesEndDate}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            dayBySalesEndDate: event.target.value,
                          }))
                        }
                      />
                      {fieldErrors.dayBySalesEndDate ? (
                        <p className="mt-1 text-xs text-red-600">
                          {fieldErrors.dayBySalesEndDate}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {dayBySalesDates.length ? (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Sales data by day ({dayBySalesDates.length} days)
                      </p>
                      {salesDataLoading ? (
                        <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
                      ) : (
                        <div className="overflow-auto rounded-lg border border-zinc-200">
                          <table className="min-w-full text-sm">
                            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600">
                              <tr>
                                <th className="px-3 py-2">Date</th>
                                {showStoreInSalesGrid ? (
                                  <th className="px-3 py-2">Store</th>
                                ) : null}
                                <th className="px-3 py-2 text-right">Products</th>
                                <th className="px-3 py-2 text-right">Total sold qty</th>
                                <th className="px-3 py-2">Last updated</th>
                                <th className="px-3 py-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesDataRows.map((row) => (
                                <tr
                                  key={`${row.salesDate}-${row.storeId}`}
                                  className="border-t border-zinc-100"
                                >
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    <span className="font-medium text-zinc-900">
                                      {formatDaySalesLabel(row.salesDate)}
                                    </span>
                                    <span className="ml-2 text-xs text-zinc-500">
                                      {row.salesDate}
                                    </span>
                                  </td>
                                  {showStoreInSalesGrid ? (
                                    <td className="px-3 py-2">
                                      <span className="font-medium">{row.storeCode}</span>
                                      <span className="ml-2 text-zinc-500">{row.storeName}</span>
                                    </td>
                                  ) : null}
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {row.available ? row.itemCount.toLocaleString() : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {row.available
                                      ? formatDecimal(parseDbDecimal(row.totalSoldQty), 2)
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-600">
                                    {row.lastUpdated ? formatDateTime(row.lastUpdated) : "—"}
                                  </td>
                                  <td
                                    className={`px-3 py-2 font-medium ${
                                      row.available ? "text-emerald-700" : "text-red-700"
                                    }`}
                                  >
                                    {row.available ? "Imported" : "No sales data"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div>
                <Label>Sold qty calculation</Label>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {(["max", "average", "min"] as SoldQtyMethod[]).map((method) => (
                    <label key={method} className="flex items-center gap-2 capitalize">
                      <input
                        type="radio"
                        name="soldQtyMethod"
                        checked={form.soldQtyMethod === method}
                        onChange={() =>
                          setForm((current) => ({ ...current, soldQtyMethod: method }))
                        }
                      />
                      {method}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Shortfall period</Label>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <DateField
                    name="shortfallStartDate"
                    value={form.shortfallStartDate}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        shortfallStartDate: event.target.value,
                      }))
                    }
                  />
                  <DateField
                    name="shortfallEndDate"
                    value={form.shortfallEndDate}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        shortfallEndDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <p className="mt-2 text-sm font-medium text-blue-700">{shortfallDays} days</p>
              </div>
            </div>
          </OrderSheetSection>

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
                            {row.latest
                              ? new Date(row.latest.importedAt).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-3 py-2 font-medium text-zinc-900">
                            {row.latest?.bookStockDate ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.latest ? row.latest.itemCount.toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.latest
                              ? formatDecimal(parseDbDecimal(row.latest.totalBookStockQty), 2)
                              : "—"}
                          </td>
                          <td
                            className={`px-3 py-2 font-medium ${
                              row.latest ? "text-emerald-700" : "text-red-700"
                            }`}
                          >
                            {row.latest ? "Latest upload" : "No saved book stock"}
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
                          <td className="px-3 py-2">{formatDateTime(row.lastUpdated)}</td>
                          <td className={`px-3 py-2 font-semibold ${statusClass(row.status)}`}>
                            {statusIcon(row.status)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Select suppliers to view price data status.</p>
              )}
            </OrderSheetSection>
          </div>
        </div>

        <div className="border-t border-zinc-100" />

        <OrderSheetSection number={6} title="Comparison Periods" compact>
          <div className="space-y-3">
            {form.comparisonPeriods.map((period, index) => (
              <div
                key={period.id}
                className="grid gap-4 rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
              >
                <p className="pb-2 text-sm font-medium text-zinc-800 sm:pb-0">
                  Period {index + 1}
                </p>
                <div>
                  <Label>Start Date</Label>
                  <DateField
                    name={`period-${period.id}-start`}
                    className="mt-1.5"
                    value={period.startDate}
                    onChange={(event) =>
                      updatePeriod(period.id, { startDate: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>End Date</Label>
                  <DateField
                    name={`period-${period.id}-end`}
                    className="mt-1.5"
                    value={period.endDate}
                    onChange={(event) =>
                      updatePeriod(period.id, { endDate: event.target.value })
                    }
                  />
                  {fieldErrors[`period-${index}`] ? (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors[`period-${index}`]}</p>
                  ) : null}
                </div>
                <div className="flex justify-end sm:justify-start">
                  {form.comparisonPeriods.length > 1 ? (
                    <Button type="button" variant="outline" onClick={() => removePeriod(period.id)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {fieldErrors.comparisonPeriods ? (
            <p className="mt-2 text-xs text-red-600">{fieldErrors.comparisonPeriods}</p>
          ) : null}
          <Button type="button" variant="outline" className="mt-4" onClick={addPeriod}>
            + Add Period
          </Button>
        </OrderSheetSection>

        <div className="border-t border-zinc-100" />

        <OrderSheetSection number={7} title="Comment" compact>
          <Textarea
            value={form.comment}
            maxLength={500}
            onChange={(event) =>
              setForm((current) => ({ ...current, comment: event.target.value }))
            }
            placeholder="Enter any notes or comments..."
            rows={3}
          />
          <p className="mt-1 text-xs text-zinc-500">{form.comment.length}/500</p>
        </OrderSheetSection>
      </OrderSheetPanel>

      {result ? (
        <OrderSheetPanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Products", result.summary.productCount.toLocaleString()],
              ["Products To Order", result.summary.productsToOrder.toLocaleString()],
              ["Total Suggested Qty", result.summary.totalSuggestedQty],
              ["Selected Suppliers", String(result.summary.selectedSupplierCount)],
              ["Shortfall", `${result.summary.shortfallDays} Days`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
                <p className="text-lg font-semibold text-zinc-900">{value}</p>
              </div>
            ))}
          </div>

          <OrderSheetResultsTable
            items={items}
            periodLabels={result.periodLabels}
            dailySalesLabels={result.dailySalesLabels}
            includeWastage={form.includeWastage}
            includeRtc={form.includeRtc}
            showStoreColumn={form.storeIds.length > 1}
            onToggleSelected={(orderItemId, selected) =>
              setItems((current) =>
                current.map((item) =>
                  item.orderItemId === orderItemId ? { ...item, selected } : item,
                ),
              )
            }
            onToggleAll={(selected) =>
              setItems((current) => current.map((item) => ({ ...item, selected })))
            }
            onOrderQtyChange={(orderItemId, orderQty) =>
              setItems((current) =>
                current.map((item) =>
                  item.orderItemId === orderItemId ? { ...item, orderQty } : item,
                ),
              )
            }
          />
        </OrderSheetPanel>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-64 lg:px-8">
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setConfirmClear(true)}>
            Clear All
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!orderId || saving}
            onClick={() => void onSaveDraft()}
          >
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button type="button" variant="outline" disabled={!orderId} onClick={() => void onExport()}>
            Export Excel
          </Button>
          <Button type="button" disabled={generating} onClick={() => void onGenerate()}>
            {generating ? "Generating..." : "Generate Order Sheet"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!orderId}
            onClick={() => orderId && router.push(`/orders/${orderId}`)}
          >
            Finalise Order
          </Button>
        </div>
      </div>

      <ConfirmAlertDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear order sheet?"
        description="This will reset the form and remove generated results."
        confirmLabel="Clear All"
        onConfirm={onClearAll}
      />
    </div>
  );
}
