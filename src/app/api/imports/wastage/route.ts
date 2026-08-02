import { z } from "zod";
import { storeRepository } from "@/repositories";
import {
  deleteWastageForStoreDate,
  importWastageRows,
  listWastageSummariesForStore,
} from "@/services/wastage-import.service";
import { WASTAGE_IMPORT_CHUNK_SIZE } from "@/lib/wastage-import-constants";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import {
  detectWastageFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { idSchema } from "@/validators/schemas";

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  wastageDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1).optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(WASTAGE_IMPORT_CHUNK_SIZE),
});

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listWastageSummariesForStore(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const wastageDate = z.string().date().safeParse(params.get("wastageDate"));
  if (!storeId.success || !wastageDate.success) {
    return apiError("storeId and wastageDate (yyyy-MM-dd) are required");
  }
  await deleteWastageForStoreDate(storeId.data, wastageDate.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, chunkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const headers = [parsed.data.referenceColumn, parsed.data.quantityColumn];
  const mismatch = validateErpFileMatch(
    detectWastageFileErpType(headers, parsed.data.fileName ?? ""),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) return apiError(mismatch);

  const result = await importWastageRows({
    storeId: parsed.data.storeId,
    wastageDate: parsed.data.wastageDate,
    referenceColumn: parsed.data.referenceColumn,
    quantityColumn: parsed.data.quantityColumn,
    rows: parsed.data.rows,
  });

  return apiOk(result);
});
