import type { ActionResult, FilePreview, ImportResult } from "@/types";
import { apiFormRequest, apiRequest } from "./client";

export type DailySalesParseResult = FilePreview & {
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export async function parseDailySalesFile(
  formData: FormData,
): Promise<DailySalesParseResult> {
  const result = await apiFormRequest<DailySalesParseResult>(
    "/imports/daily-sales/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type DailySalesImportChunkInput = {
  storeId: number;
  mappingType?: "store_product_code" | "barcode";
  productColumn: string;
  quantityColumn: string;
  manualSalesDate: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importDailySalesChunk(
  input: DailySalesImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/daily-sales", { method: "POST", body: input });
}

export function deleteDailySalesUpload(
  storeId: number,
  salesDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    salesDate,
  });
  return apiRequest(`/imports/daily-sales?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listDailySalesSummaries(
  storeId: number,
  page: number,
  pageSize: number,
): Promise<
  ActionResult<
    {
      rows: Array<{
        salesDate: string;
        itemCount: number;
        totalSoldQty: string;
        lastUpdated: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }
  >
> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    page: String(page),
    pageSize: String(pageSize),
  });
  return apiRequest(`/imports/daily-sales?${params.toString()}`);
}
