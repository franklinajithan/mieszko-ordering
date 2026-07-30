import {
  deleteWastageUpload,
  importWastage,
  listWastageSummaries,
} from "@/app/actions";
import { apiError, fromActionResult, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";
import { z } from "zod";

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return fromActionResult(await listWastageSummaries(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const wastageDate = z.string().date().safeParse(params.get("wastageDate"));
  if (!storeId.success || !wastageDate.success) {
    return apiError("storeId and wastageDate (yyyy-MM-dd) are required");
  }
  return fromActionResult(
    await deleteWastageUpload(storeId.data, wastageDate.data),
  );
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  return fromActionResult(await importWastage(formData));
});
