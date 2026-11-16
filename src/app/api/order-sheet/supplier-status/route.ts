import { getSupplierDataStatus } from "@/services/order-sheet.service";
import { apiError, apiOk, route } from "@/lib/api/http";

export const GET = route(async (req) => {
  const idsParam = new URL(req.url).searchParams.get("supplierIds") ?? "";
  const supplierIds = idsParam
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!supplierIds.length) {
    return apiError("supplierIds query parameter is required");
  }

  return apiOk(await getSupplierDataStatus(supplierIds));
});
