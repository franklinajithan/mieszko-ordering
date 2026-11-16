import { z } from "zod";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";
import {
  assignExpectedDeliveryDateToUpload,
  deleteFutureUpload,
  importFutureOcsFiles,
  importFutureOrderFiles,
  listFutureUploads,
} from "@/services/future-deliveries/future-delivery-import.service";

function collectFiles(formData: FormData): File[] {
  const named = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (named.length) return named;
  const single = formData.get("file");
  if (single instanceof File && single.size > 0) return [single];
  return [];
}

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listFutureUploads(storeId.data));
});

const assignDateSchema = z.object({
  storeId: idSchema,
  importedAt: z.string().datetime(),
  fileName: z.string().min(1),
  source: z.string().min(1),
  previousExpectedDeliveryDate: z.string().date().nullable().optional(),
  expectedDeliveryDate: z.string().date(),
});

export const PATCH = route(async (req) => {
  const parsed = await parseJson(req, assignDateSchema);
  if (!parsed.ok) return parsed.response;
  const updated = await assignExpectedDeliveryDateToUpload(parsed.data);
  return apiOk({ updatedRows: updated });
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const importedAt = z.string().datetime().safeParse(params.get("importedAt"));
  if (!storeId.success || !importedAt.success) {
    return apiError("storeId and importedAt (ISO timestamp) are required");
  }
  await deleteFutureUpload(storeId.data, importedAt.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  const storeId = idSchema.safeParse(formData.get("storeId"));
  if (!storeId.success) return apiError("storeId is required");

  const source = String(formData.get("source") ?? "ocs");
  const expectedDeliveryDate = z.string().date().safeParse(formData.get("expectedDeliveryDate"));
  if (!expectedDeliveryDate.success) return apiError("A valid expected delivery date (YYYY-MM-DD) is required");
  const files = collectFiles(formData);
  if (!files.length) return apiError("Choose at least one future delivery file");

  const payloads = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );

  if (source === "ocs") {
    return apiOk(
      await importFutureOcsFiles({
        storeId: storeId.data,
        files: payloads,
        expectedDeliveryDate: expectedDeliveryDate.data,
      }),
    );
  }

  if (source === "order" || source === "invoice") {
    const supplierId = idSchema.safeParse(formData.get("supplierId"));
    if (!supplierId.success) {
      return apiError("Select a supplier before uploading this file");
    }
    return apiOk(
      await importFutureOrderFiles({
        storeId: storeId.data,
        supplierId: supplierId.data,
        files: payloads,
        expectedDeliveryDate: expectedDeliveryDate.data,
        source,
      }),
    );
  }

  return apiError("Unknown future delivery source");
});
