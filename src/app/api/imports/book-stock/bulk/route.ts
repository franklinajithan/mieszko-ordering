import { z } from "zod";
import { storeRepository } from "@/repositories";
import { importBookStockBulk } from "@/services/book-stock-import.service";
import { BOOK_STOCK_BULK_MAX_ROWS } from "@/lib/import-config";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import {
  detectBookStockFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";

const bulkSchema = z.object({
  storeId: z.number().int().positive(),
  bookStockDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
  duplicateRows: z.number().int().nonnegative().optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(BOOK_STOCK_BULK_MAX_ROWS),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, bulkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const headers = [parsed.data.referenceColumn, parsed.data.quantityColumn];
  const mismatch = validateErpFileMatch(
    detectBookStockFileErpType(headers, parsed.data.fileName),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) return apiError(mismatch);

  const result = await importBookStockBulk(parsed.data);
  return apiOk(result);
});
