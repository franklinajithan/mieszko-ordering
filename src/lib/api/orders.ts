import type { ActionResult } from "@/types";
import { apiRequest } from "./client";

export function exportOrder(input: {
  orderId: number;
}): Promise<ActionResult<{ base64: string; fileName: string }>> {
  return apiRequest(`/orders/${input.orderId}/export`, { method: "POST" });
}
