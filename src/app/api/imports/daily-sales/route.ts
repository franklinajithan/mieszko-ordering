import { deleteDailySalesUpload, importDailySales, listDailySalesSummaries } from "@/app/actions";
import { apiError, fromActionResult, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";
import { z } from "zod";

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
  const formData = await req.formData();
  return fromActionResult(await importDailySales(formData));
});
