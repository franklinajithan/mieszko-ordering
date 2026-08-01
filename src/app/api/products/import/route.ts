import { z } from "zod";
import { storeRepository } from "@/repositories";
import { importProductRows } from "@/services/product-import.service";

import {
  inferProductFileErpTypeFromColumns,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";


const PRODUCT_IMPORT_CHUNK_SIZE = parseInt(process.env.NEXT_PUBLIC_PRODUCT_IMPORT_CHUNK_SIZE ?? "2000");

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  codeColumn: z.string().min(1),
  nameColumn: z.string().min(1),
  departmentColumn: z.string().optional(),
  barcodeColumn: z.string().optional(),
  retailPriceColumn: z.string().optional(),
  shareAcrossMspStores: z.boolean().optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(PRODUCT_IMPORT_CHUNK_SIZE),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, chunkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = inferProductFileErpTypeFromColumns(parsed.data);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return apiError(mismatch);

  const result = await importProductRows({
    storeId: parsed.data.storeId,
    codeColumn: parsed.data.codeColumn,
    nameColumn: parsed.data.nameColumn,
    departmentColumn: parsed.data.departmentColumn,
    barcodeColumn: parsed.data.barcodeColumn,
    retailPriceColumn: parsed.data.retailPriceColumn,
    shareAcrossMspStores: parsed.data.shareAcrossMspStores,
    rows: parsed.data.rows,
  });

  return apiOk(result);
});
