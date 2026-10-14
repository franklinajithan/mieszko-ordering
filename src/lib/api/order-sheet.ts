import type { ActionResult } from "@/types";
import type {
  BookStockStatusRow,
  OrderSheetGenerateInput,
  OrderSheetResult,
  SalesDataStatusRow,
  SupplierDataStatusRow,
} from "@/types/orderSheet";
import { apiRequest } from "./client";

export function generateOrderSheet(
  input: OrderSheetGenerateInput,
): Promise<ActionResult<OrderSheetResult>> {
  return apiRequest("/order-sheet/generate", { method: "POST", body: input });
}

export function getOrderSheetBookStockStatus(
  storeIds: number[],
): Promise<ActionResult<BookStockStatusRow[]>> {
  const query = storeIds.map(String).join(",");
  return apiRequest(`/order-sheet/book-stock-status?storeIds=${query}`);
}

export function getOrderSheetSupplierStatus(
  supplierIds: number[],
): Promise<ActionResult<SupplierDataStatusRow[]>> {
  const query = supplierIds.map(String).join(",");
  return apiRequest(`/order-sheet/supplier-status?supplierIds=${query}`);
}

export function getOrderSheetSalesDataStatus(input: {
  storeIds: number[];
  startDate: string;
  endDate: string;
}): Promise<ActionResult<SalesDataStatusRow[]>> {
  const storeQuery = input.storeIds.map(String).join(",");
  const params = new URLSearchParams({
    storeIds: storeQuery,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  return apiRequest(`/order-sheet/sales-data-status?${params.toString()}`);
}

export function saveOrderSheetDraft(input: {
  orderId: number;
  comment?: string;
  items: Array<{ orderItemId: number; orderQty: string; selected: boolean }>;
}): Promise<ActionResult<null>> {
  return apiRequest(`/order-sheet/${input.orderId}/draft`, {
    method: "PUT",
    body: {
      comment: input.comment,
      items: input.items,
    },
  });
}

export type OrderSheetPreflight = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  bookStock: BookStockStatusRow[];
  suppliers: SupplierDataStatusRow[];
  salesPeriods: Array<{
    startDate: string;
    endDate: string;
    totalStoreDays: number;
    availableStoreDays: number;
    totalItems: number;
  }>;
};

export function preflightOrderSheet(input: {
  storeIds: number[];
  supplierIds: number[];
  comparisonPeriods: Array<{ startDate: string; endDate: string }>;
}): Promise<ActionResult<OrderSheetPreflight>> {
  return apiRequest("/order-sheet/preflight", { method: "POST", body: input });
}
