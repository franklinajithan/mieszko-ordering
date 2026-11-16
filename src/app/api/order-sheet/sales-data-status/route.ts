import { isIsoDateString } from "@/utils/iso-date";
import { resolveSalesDataStatus } from "@/services/order-sheet.service";
import { apiError, apiOk, route } from "@/lib/api/http";

export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const idsParam = params.get("storeIds") ?? "";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";

  const storeIds = idsParam
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!storeIds.length) {
    return apiError("storeIds query parameter is required");
  }
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate)) {
    return apiError("Valid startDate and endDate query parameters are required (YYYY-MM-DD)");
  }
  if (endDate < startDate) {
    return apiError("endDate cannot be before startDate");
  }

  return apiOk(
    await resolveSalesDataStatus({
      storeIds,
      startDate,
      endDate,
    }),
  );
});
