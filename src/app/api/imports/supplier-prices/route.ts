import { z } from "zod";
import {
  deleteSupplierPriceUpload,
  importSupplierPriceRows,
  importSupplierPricesFromForm,
  listSupplierPriceUploads,
} from "@/services/supplier-prices/supplier-price-import.service";
import { SUPPLIER_PRICES_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

const chunkSchema = z.object({
  supplierId: z.number().int().positive(),
  referenceColumn: z.string().min(1),
  priceColumn: z.string().min(1),
  caseSizeColumn: z.string().min(1).optional(),
  effectiveDate: z.string().date(),
  importedAt: z.string().datetime().optional(),
  fileName: z.string().min(1),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(SUPPLIER_PRICES_IMPORT_CHUNK_SIZE),
});

export const GET = route(async () => {
  return apiOk(await listSupplierPriceUploads());
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const supplierId = idSchema.safeParse(params.get("supplierId"));
  const importedAt = z.string().datetime().safeParse(params.get("importedAt"));
  if (!supplierId.success || !importedAt.success) {
    return apiError("supplierId and importedAt (ISO timestamp) are required");
  }
  await deleteSupplierPriceUpload(supplierId.data, importedAt.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await parseJson(req, chunkSchema);
    if (!parsed.ok) return parsed.response;
    return apiOk(await importSupplierPriceRows(parsed.data));
  }

  const formData = await req.formData();
  return apiOk(await importSupplierPricesFromForm(formData));
});
