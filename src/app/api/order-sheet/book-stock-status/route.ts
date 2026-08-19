import { resolveBookStockStatuses } from "@/services/order-sheet.service";
import { apiError, apiOk, route } from "@/lib/api/http";

export const GET = route(async (req) => {
  const idsParam = new URL(req.url).searchParams.get("storeIds") ?? "";
  const storeIds = idsParam
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!storeIds.length) {
    return apiError("storeIds query parameter is required");
  }

  return apiOk(await resolveBookStockStatuses(storeIds));
});
