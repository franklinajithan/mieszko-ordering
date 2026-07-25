import type { ActionResult } from "@/types";
import { apiRequest } from "./client";

export function createSupplier(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/suppliers", { method: "POST", body: input });
}

export function updateSupplier(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/suppliers/${id}`, { method: "PATCH", body });
}

export function toggleSupplierActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/suppliers/${id}`, {
    method: "PATCH",
    body: { isActive },
  });
}
