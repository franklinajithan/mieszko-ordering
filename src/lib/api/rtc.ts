import type { ActionResult, FilePreview, ImportResult } from "@/types";
import { RTC_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiFormRequest, apiRequest } from "./client";

export { RTC_IMPORT_CHUNK_SIZE };

export type RtcParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  rtcDate?: string;
  emptyReport?: boolean;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedBarcodes?: string[];
};

export async function parseRtcFile(formData: FormData): Promise<RtcParseResult> {
  const result = await apiFormRequest<RtcParseResult>(
    "/imports/rtc/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type RtcImportChunkInput = {
  storeId: number;
  rtcDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importRtcChunk(
  input: RtcImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/rtc", { method: "POST", body: input });
}

export function matchRtcBarcodes(input: {
  storeId: number;
  barcodes: string[];
}): Promise<
  ActionResult<
    Array<{
      fileBarcode: string;
      storeProductCode: string;
      productName: string | null;
    }>
  >
> {
  return apiRequest("/imports/rtc/match-barcodes", {
    method: "POST",
    body: input,
  });
}

export function deleteRtcUpload(
  storeId: number,
  rtcDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    rtcDate,
  });
  return apiRequest(`/imports/rtc?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listRtcSummaries(
  storeId: number,
): Promise<
  ActionResult<
    Array<{
      rtcDate: string;
      itemCount: number;
      totalRtcQty: string;
      lastUpdated: string;
    }>
  >
> {
  return apiRequest(`/imports/rtc?storeId=${storeId}`);
}

export function importRtcReportFile(form:FormData){return apiFormRequest<ImportResult & {message:string;zeroActivity:boolean}>("/imports/rtc",form);}
