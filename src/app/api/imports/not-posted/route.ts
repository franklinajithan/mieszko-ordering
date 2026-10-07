import { z } from "zod";
import { apiError, apiOk, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";
import {
  deleteNotPostedUpload,
  importNotPostedDeliveryFiles,
  listNotPostedUploads,
} from "@/services/not-posted/not-posted-import.service";

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
  return apiOk(await listNotPostedUploads(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const importedAt = z.string().datetime().safeParse(params.get("importedAt"));
  if (!storeId.success || !importedAt.success) {
    return apiError("storeId and importedAt (ISO timestamp) are required");
  }
  await deleteNotPostedUpload(storeId.data, importedAt.data);
  return apiOk(undefined);
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  const storeId = idSchema.safeParse(formData.get("storeId"));
  if (!storeId.success) return apiError("storeId is required");

  const files = collectFiles(formData);
  if (!files.length) return apiError("Choose at least one delivery file");

  const result = await importNotPostedDeliveryFiles({
    storeId: storeId.data,
    files: await Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
      })),
    ),
  });

  return apiOk(result);
});
