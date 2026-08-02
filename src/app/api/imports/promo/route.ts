import {
  importPromoFromForm,
  listPromoImportsForStore,
} from "@/services/promo-import.service";
import { apiError, apiOk, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listPromoImportsForStore(storeId.data));
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  return apiOk(await importPromoFromForm(formData));
});
