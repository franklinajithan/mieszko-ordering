import type { ActionResult, ImportResult } from "@/types";
import { apiFormRequest } from "./client";

export function importSupplierPrices(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/imports/supplier-prices", formData);
}
