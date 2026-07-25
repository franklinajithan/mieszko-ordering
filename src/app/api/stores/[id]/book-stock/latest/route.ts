import { getLatestBookStockForStore } from "@/app/actions";
import { apiError, fromActionResult, numericParam, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const storeId = await numericParam(params);
    if (storeId === null) return apiError("Invalid store id");
    return fromActionResult(await getLatestBookStockForStore(storeId));
  },
);
