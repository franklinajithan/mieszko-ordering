import type { ActionResult } from "@/types";
import { apiRequest } from "./client";

export function exportOrder(input: {
  orderId: number;
  format?: "standard" | "dairy";
}): Promise<ActionResult<{ base64: string; fileName: string }>> {
  return apiRequest(`/orders/${input.orderId}/${input.format === "dairy" ? "export-dairy" : "export"}`, { method: "POST" });
}
