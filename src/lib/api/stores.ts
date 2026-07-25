import type { ActionResult } from "@/types";
import { apiRequest } from "./client";

export function createStore(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/stores", { method: "POST", body: input });
}

export function updateStore(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/stores/${id}`, { method: "PATCH", body });
}

export function toggleStoreActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/stores/${id}`, { method: "PATCH", body: { isActive } });
}
