import { z } from "zod";
import {
  deleteWastageForStoreDate,
  importWastageFromForm,
  listWastageSummariesForStore,
} from "@/services/wastage-import.service";
import { apiError, apiOk, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

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
  const formData = await req.formData();
  return apiOk(await importWastageFromForm(formData));
});
