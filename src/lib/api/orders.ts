import type { ActionResult, ImportResult } from "@/types";
import { apiFormRequest, apiRequest } from "./client";

export function createOrder(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/orders", { method: "POST", body: input });
}

export function updateOrderPeriods(input: {
  orderId: number;
  periods: Array<{ periodKey: string; startDate: string; endDate: string }>;
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/periods`, {
    method: "PUT",
    body: { periods: input.periods },
  });
}

export function updateOrderSelectedSuppliers(input: {
  orderId: number;
  supplierIds: number[];
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/suppliers`, {
    method: "PUT",
    body: { supplierIds: input.supplierIds },
  });
}

export function calculateOrderAction(input: {
  orderId: number;
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/calculate`, { method: "POST" });
}

export function updateFinalOrderQuantity(input: {
  orderItemId: number;
  finalOrderQty: string;
}): Promise<ActionResult> {
  return apiRequest(`/order-items/${input.orderItemId}`, {
    method: "PATCH",
    body: { finalOrderQty: input.finalOrderQty },
  });
}

export function uploadOrderStockFile(
  formData: FormData,
): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  const orderId = String(formData.get("orderId") ?? "");
  return apiFormRequest(`/orders/${orderId}/stock-upload`, formData);
}

export function applyStoredBookStockToOrder(input: {
  orderId: number;
  importId: number;
}): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  return apiRequest(`/orders/${input.orderId}/apply-book-stock`, {
    method: "POST",
    body: { importId: input.importId },
  });
}

export function exportOrder(input: {
  orderId: number;
}): Promise<ActionResult<{ base64: string; fileName: string }>> {
  return apiRequest(`/orders/${input.orderId}/export`, { method: "POST" });
}

export function exportHoDairyWithTemplate(
  formData: FormData,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  const orderId = String(formData.get("orderId") ?? "");
  return apiFormRequest(`/orders/${orderId}/export-ho-dairy`, formData);
}
