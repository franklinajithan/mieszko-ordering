import { z } from "zod";
import { storeRepository } from "@/repositories";
import {
  deleteRtcForStoreDate,
  importRtcRows,
  listRtcSummariesForStore,
} from "@/services/rtc-import.service";
import { RTC_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import {
  detectRtcFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { idSchema } from "@/validators/schemas";

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  rtcDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1).optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(RTC_IMPORT_CHUNK_SIZE),
});

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listRtcSummariesForStore(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const rtcDate = z.string().date().safeParse(params.get("rtcDate"));
  if (!storeId.success || !rtcDate.success) {
    return apiError("storeId and rtcDate (yyyy-MM-dd) are required");
  }
  await deleteRtcForStoreDate(storeId.data, rtcDate.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, chunkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const headers = [parsed.data.referenceColumn, parsed.data.quantityColumn];
  const mismatch = validateErpFileMatch(
    detectRtcFileErpType(headers, parsed.data.fileName ?? ""),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) return apiError(mismatch);

  const result = await importRtcRows({
    storeId: parsed.data.storeId,
    rtcDate: parsed.data.rtcDate,
    referenceColumn: parsed.data.referenceColumn,
    quantityColumn: parsed.data.quantityColumn,
    rows: parsed.data.rows,
  });

  return apiOk(result);
});
