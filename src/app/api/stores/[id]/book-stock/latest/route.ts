import { getLatestBookStockSummary } from "@/services/apply-book-stock-to-order.service";
import { apiError, apiOk, numericParam, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const storeId = await numericParam(params);
    if (storeId === null) return apiError("Invalid store id");
    return apiOk(await getLatestBookStockSummary(storeId));
  },
);
