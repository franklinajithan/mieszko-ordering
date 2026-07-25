import { importBookStock, listBookStockImports } from "@/app/actions";
import { apiError, fromActionResult, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return fromActionResult(await listBookStockImports(storeId.data));
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  return fromActionResult(await importBookStock(formData));
});
