import {
  importBookStockFromForm,
} from "@/services/book-stock-import.service";
import { listBookStockImportsForStore } from "@/services/apply-book-stock-to-order.service";
import { apiError, apiOk, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return apiOk(await listBookStockImportsForStore(storeId.data));
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  return apiOk(await importBookStockFromForm(formData));
});
