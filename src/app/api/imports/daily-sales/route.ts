import { z } from "zod";
import { deleteDailySalesUpload, listDailySalesSummaries } from "@/app/actions";
import { storeRepository } from "@/repositories";
import { importDailySalesRows } from "@/services/daily-sales-import.service";
import { apiError, apiOk, fromActionResult, parseJson, route } from "@/lib/api/http";
import {
  detectDailySalesFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { idSchema } from "@/validators/schemas";

const DAILY_SALES_IMPORT_CHUNK_SIZE = parseInt(process.env.NEXT_PUBLIC_DAILY_SALES_IMPORT_CHUNK_SIZE ?? "2000");

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  mappingType: z.enum(["store_product_code", "barcode"]).default("store_product_code"),
  productColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  manualSalesDate: z.string().date(),
  fileName: z.string().min(1).optional(),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(DAILY_SALES_IMPORT_CHUNK_SIZE),
});

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return fromActionResult(await listDailySalesSummaries(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const salesDate = z.string().date().safeParse(params.get("salesDate"));
  if (!storeId.success || !salesDate.success) {
    return apiError("storeId and salesDate (yyyy-MM-dd) are required");
  }
  return fromActionResult(
    await deleteDailySalesUpload(storeId.data, salesDate.data),
  );
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, chunkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const headers = [
    parsed.data.productColumn,
    parsed.data.quantityColumn,
  ];
  const mismatch = validateErpFileMatch(
    detectDailySalesFileErpType(headers, parsed.data.fileName ?? ""),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) return apiError(mismatch);

  const result = await importDailySalesRows({
    storeId: parsed.data.storeId,
    mappingType: parsed.data.mappingType,
    productColumn: parsed.data.productColumn,
    quantityColumn: parsed.data.quantityColumn,
    manualSalesDate: parsed.data.manualSalesDate,
    rows: parsed.data.rows,
  });

  return apiOk(result);
});
