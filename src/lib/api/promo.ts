import type { ActionResult, ImportResult } from "@/types";
import type { PromoImportSummary } from "@/services/promo-import.service";
import { apiFormRequest, apiRequest } from "./client";

export function importPromo(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/promo", formData);
}

export function listPromoImports(
  storeId: number,
): Promise<ActionResult<PromoImportSummary[]>> {
  return apiRequest(`/imports/promo?storeId=${storeId}`);
}
