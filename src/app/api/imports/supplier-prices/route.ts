import { importSupplierPricesFromForm } from "@/services/supplier-price-import.service";
import { apiOk, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const formData = await req.formData();
  return apiOk(await importSupplierPricesFromForm(formData));
});
