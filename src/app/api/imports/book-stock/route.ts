import { z } from "zod";
import { storeRepository } from "@/repositories";
import {
  deleteBookStockForStoreUpload,
  importBookStockChunk,
  importBookStockFromForm,
  listBookStockSummariesForStore,
} from "@/services/book-stock-import.service";
import { BOOK_STOCK_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import {
  detectBookStockFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { idSchema } from "@/validators/schemas";

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  bookStockDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
  importedAt: z.string().datetime().optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(BOOK_STOCK_IMPORT_CHUNK_SIZE),
});

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listBookStockSummariesForStore(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const importedAt = z.string().datetime().safeParse(params.get("importedAt"));
  if (!storeId.success || !importedAt.success) {
    return apiError("storeId and importedAt (ISO timestamp) are required");
  }
  await deleteBookStockForStoreUpload(storeId.data, importedAt.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await parseJson(req, chunkSchema);
    if (!parsed.ok) return parsed.response;

    const store = await storeRepository.getById(parsed.data.storeId);
    if (!store) return apiError("Store not found", 404);

    const headers = [parsed.data.referenceColumn, parsed.data.quantityColumn];
    const mismatch = validateErpFileMatch(
      detectBookStockFileErpType(headers, parsed.data.fileName),
      resolveStoreErpType(store.erpType),
    );
    if (mismatch) return apiError(mismatch);

    const result = await importBookStockChunk(parsed.data);
    return apiOk(result);
  }

  const formData = await req.formData();
  return apiOk(await importBookStockFromForm(formData));
});
