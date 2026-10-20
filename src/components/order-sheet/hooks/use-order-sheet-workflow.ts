"use client";
import { previewOrderItem } from "@/utils/order-item-edit";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  exportOrder,
  generateOrderSheet,
  preflightOrderSheet,
  saveOrderSheetDraft,
} from "@/lib/api";
import type {
  BookStockStatusRow,
  OrderSheetFormState,
  OrderSheetItem,
  OrderSheetResult,
} from "@/types/orderSheet";
import {
  createInitialOrderSheetForm,
  validateOrderSheetForm,
} from "@/utils/order-sheet-form";

type Input = {
  form: OrderSheetFormState;
  dayBySalesDates: string[];
  bookStockRows: BookStockStatusRow[];
  setForm: Dispatch<SetStateAction<OrderSheetFormState>>;
  setBookStockRows: Dispatch<SetStateAction<BookStockStatusRow[]>>;
  onMissingData?: () => void;
};

export function useOrderSheetWorkflow({
  form,
  dayBySalesDates,
  bookStockRows,
  setForm,
  setBookStockRows,
  onMissingData,
}: Input) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<{
    percent: number;
    done: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [result, setResult] = useState<OrderSheetResult | null>(null);
  const [items, setItems] = useState<OrderSheetItem[]>([]);
  const [orderId, setOrderId] = useState<number | null>(null);

  function validateForm(): boolean {
    const errors = validateOrderSheetForm(form, dayBySalesDates);
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onGenerate() {
    setError(null);
    setDataWarnings([]);
    if (!validateForm() || !form.storeIds.length) return;

    setGenerating(true);
    setGenerateProgress({ percent: 12, done: false });
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next = Math.min(99, 8 + Math.round((1 - Math.exp(-elapsed / 20000)) * 91));
      setGenerateProgress((current) =>
        current && !current.done ? { percent: next, done: false } : current,
      );
    }, 400);
    try {
      const preflight = await preflightOrderSheet({
        storeIds: form.storeIds,
        supplierIds: form.supplierIds,
        deliveryDate: form.deliveryDate,
        includeRtc: form.includeRtc,
        includeWastage: form.includeWastage,
        includeBookStock: form.includeBookStock,
        includeFutureDeliveries: form.includeFutureDeliveries,
        bookStockDate: bookStockRows[0]?.bookStockDate ?? undefined,
        dayBySalesRequired: form.dayBySalesRequired,
        dayBySalesStartDate: form.dayBySalesStartDate,
        dayBySalesEndDate: form.dayBySalesEndDate,
        comparisonPeriods: form.comparisonPeriods.map(({ startDate, endDate }) => ({ startDate, endDate })),
      });
      if (!preflight.success) {
        setGenerateProgress(null);
        setError("Unable to retrieve order source data: " + preflight.error);
        return;
      }
      setDataWarnings(preflight.data.warnings);
      setBookStockRows(preflight.data.bookStock);
      const missingReports = preflight.data.feedCoverage?.reduce((count,feed)=>count+feed.missing.length,0) ?? 0;
      if (missingReports > 0) {
        setGenerateProgress(null);
        setError(`Missing report data for ${missingReports} store/date/feed combinations. Review the download approval before generating.`);
        onMissingData?.();
        return;
      }
      if (!preflight.data.ready) {
        setGenerateProgress(null);
        setError("Order data is incomplete. " + preflight.data.blockers.join("; "));
        onMissingData?.();
        return;
      }
      setGenerateProgress({ percent: 40, done: false });
      // Persist unsaved manual edits before recalculation replaces row IDs.
      if (orderId) await persistDraft();

      const response = await generateOrderSheet({
        orderId: orderId ?? undefined,
        storeIds: form.storeIds,
        orderDate: form.orderDate,
        deliveryDate: form.deliveryDate,
        supplierIds: form.supplierIds,
        departmentIds: form.departmentIds,
        comparisonPeriods: form.comparisonPeriods.map((period) => ({
          startDate: period.startDate,
          endDate: period.endDate,
        })),
        includeBookStock: form.includeBookStock,
        includeFutureDeliveries: form.includeFutureDeliveries,
        includeWastage: form.includeWastage,
        includeRtc: form.includeRtc,
        shortfallPeriods: form.shortfallPeriods.map((period) => ({
          startDate: period.startDate,
          endDate: period.endDate,
        })),
        soldQtyMethod: form.soldQtyMethod,
        comment: form.comment,
        dayBySalesRequired: form.dayBySalesRequired,
        dayBySalesStartDate: form.dayBySalesRequired
          ? form.dayBySalesStartDate
          : undefined,
        dayBySalesEndDate: form.dayBySalesRequired
          ? form.dayBySalesEndDate
          : undefined,
      });

      if (!response.success) {
        setGenerateProgress(null);
        setError(response.error);
        return;
      }

      setGenerateProgress({ percent: 100, done: true });
      setResult(response.data);
      setItems(response.data.items);
      setOrderId(response.data.orderId);
      if (response.data.bookStockStatus.length) {
        setBookStockRows(response.data.bookStockStatus);
      }
      window.setTimeout(() => setGenerateProgress(null), 800);
    } catch (cause) {
      setGenerateProgress(null);
      setError(
        cause instanceof Error ? cause.message : "Failed to generate order sheet",
      );
    } finally {
      window.clearInterval(tick);
      setGenerating(false);
    }
  }

  async function refreshSourceWarnings() {
    try {
      const response = await preflightOrderSheet({
        storeIds: form.storeIds,
        supplierIds: form.supplierIds,
        deliveryDate: form.deliveryDate,
        includeRtc: form.includeRtc,
        includeWastage: form.includeWastage,
        includeBookStock: form.includeBookStock,
        includeFutureDeliveries: form.includeFutureDeliveries,
        bookStockDate: bookStockRows[0]?.bookStockDate ?? undefined,
        dayBySalesRequired: form.dayBySalesRequired,
        dayBySalesStartDate: form.dayBySalesStartDate,
        dayBySalesEndDate: form.dayBySalesEndDate,
        comparisonPeriods: form.comparisonPeriods.map(({startDate,endDate})=>({startDate,endDate})),
      });
      if (response.success) {
        if(response.data.ready&&!response.data.feedCoverage?.some(feed=>feed.missing.length))setError(null);
        setDataWarnings(response.data.warnings);
        setBookStockRows(response.data.bookStock);
      }
    } catch {
      // Recovery status remains visible; an unavailable preflight must not alter saved orders.
    }
  }

  async function persistDraft() {
    if (!orderId) throw new Error("Generate the order sheet before saving a draft.");
    const response = await saveOrderSheetDraft({orderId,comment:form.comment,
      items:items.map(item=>({orderItemId:item.orderItemId,orderQty:item.orderQty,selected:item.selected}))});
    if (!response.success) throw new Error(response.error);
  }
  async function onSaveDraft() {
    setSaving(true);setError(null);
    try { await persistDraft(); }
    catch (cause) { setError(cause instanceof Error?cause.message:"Unable to save draft"); }
    finally {setSaving(false);}
  }
  async function onExport(format: "standard" | "dairy" = "standard") {
    if (!orderId) return;
    setSaving(true);setError(null);
    try {
      await persistDraft();
      const response=await exportOrder({orderId,format});
      if (!response.success) throw new Error(response.error);
      const bytes=Uint8Array.from(atob(response.data.base64),char=>char.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
      const link=document.createElement("a");link.href=url;link.download=response.data.fileName;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(cause) {setError(cause instanceof Error?cause.message:"Unable to export");}
    finally {setSaving(false);}
  }

  function onClearAll() {
    setForm(createInitialOrderSheetForm());
    setResult(null);
    setItems([]);
    setOrderId(null);
    setBookStockRows([]);
    setError(null);
    setDataWarnings([]);
    setFieldErrors({});
    setConfirmClear(false);
  }

  function toggleSelected(orderItemId: number, selected: boolean) {
    setItems((current) =>
      current.map((item) =>
        item.orderItemId === orderItemId ? previewOrderItem(item, {selected}) : item,
      ),
    );
  }

  function toggleAll(selected: boolean) {
    setItems((current) => current.map((item) => previewOrderItem(item,{selected})));
  }

  function changeOrderQty(orderItemId: number, orderQty: string) {
    setItems((current) =>
      current.map((item) =>
        item.orderItemId === orderItemId ? previewOrderItem(item,{orderQty}) : item,
      ),
    );
  }

  return {
    fieldErrors,
    error,
    dataWarnings,
    generating,
    generateProgress,
    saving,
    confirmClear,
    setConfirmClear,
    result,
    items,
    orderId,
    onGenerate,
    refreshSourceWarnings,
    onSaveDraft,
    persistDraft,
    onExport,
    onClearAll,
    toggleSelected,
    toggleAll,
    changeOrderQty,
  };
}
