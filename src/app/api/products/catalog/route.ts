import { productRepository } from "@/repositories";
import { apiError, apiOk, route } from "@/lib/api/http";

function parseCatalogFilters(url: URL) {
  const storeId = Number(url.searchParams.get("storeId"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return { ok: false as const, error: "storeId is required" };
  }

  const active = url.searchParams.get("active");
  const limit = Number(url.searchParams.get("limit"));
  const offset = Number(url.searchParams.get("offset"));

  return {
    ok: true as const,
    filters: {
      storeId,
      department: url.searchParams.get("department") ?? undefined,
      isActive:
        active === "false" ? false : active === "all" ? undefined : true,
      search: url.searchParams.get("search")?.trim() || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
    },
  };
}

export const GET = route(async (req) => {
  const parsed = parseCatalogFilters(new URL(req.url));
  if (!parsed.ok) return apiError(parsed.error);

  const { filters } = parsed;
  const [products, total, duplicateNameKeys] = await Promise.all([
    productRepository.list(filters),
    productRepository.count(filters),
    productRepository.getDuplicateProductNameKeys(filters),
  ]);
  const duplicateSupplierCodeCountsByProductId =
    await productRepository.getDuplicateSupplierCodeCounts(
      filters,
      products.map((row) => row.product.id),
    );

  return apiOk({
    products,
    total,
    duplicateNameKeys,
    duplicateSupplierCodeCountsByProductId,
  });
});
