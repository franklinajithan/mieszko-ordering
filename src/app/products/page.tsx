import { ProductsPageView } from "@/components/products/product-page";
import {
  departmentRepository,
  productRepository,
  storeRepository,
} from "@/repositories";

export const maxDuration = 300;

const PAGE_SIZE_OPTIONS = [500, 1000, 1500, 2000] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

function resolvePageSize(value?: string) {
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: string;
    department?: string;
    active?: string;
    search?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const stores = await storeRepository.list();
  const departments = await departmentRepository.listActiveNames();
  const pageSize = resolvePageSize(params.pageSize);

  const storeId = params.storeId ? Number(params.storeId) : undefined;
  const validStoreId =
    storeId && Number.isInteger(storeId) && storeId > 0 ? storeId : undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const search = params.search?.trim() || undefined;
  const listFilters = validStoreId
    ? {
        storeId: validStoreId,
        department: params.department,
        isActive:
          params.active === "false"
            ? false
            : params.active === "all"
              ? undefined
              : true,
        search,
      }
    : null;

  const [products, total, duplicateNameKeys] = validStoreId
    ? await Promise.all([
        productRepository.list({
          ...listFilters!,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        productRepository.count(listFilters!),
        productRepository.getDuplicateProductNameKeys(listFilters!),
      ])
    : [[], 0, [] as string[]];

  const duplicateNames = new Set(duplicateNameKeys);
  const selectedStore = stores.find((store) => store.id === validStoreId);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const lineOffset = (safePage - 1) * pageSize;
  const paginationParams = {
    storeId: String(validStoreId),
    department: params.department,
    active: params.active,
    search: params.search,
    pageSize: String(pageSize),
  };

  return (
    <ProductsPageView
      stores={stores}
      departments={departments}
      products={products}
      total={total}
      duplicateNames={duplicateNames}
      selectedStore={selectedStore}
      validStoreId={validStoreId}
      safePage={safePage}
      pageSize={pageSize}
      pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
      defaultPageSize={DEFAULT_PAGE_SIZE}
      lineOffset={lineOffset}
      paginationParams={paginationParams}
      search={search}
      activeFilter={params.active}
      departmentFilter={params.department}
    />
  );
}
