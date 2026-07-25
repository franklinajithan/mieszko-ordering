import { Package, Store } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProductCatalogPanel } from "@/components/products/product-catalog-panel";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductForms } from "@/components/products/product-forms";
import {
  ProductImportProvider,
  ProductImportStatusBar,
} from "@/components/products/product-import-context";
import { productRepository, storeRepository, departmentRepository } from "@/repositories";

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
    <ProductImportProvider>
      <AppShell
        title="Products"
        description="Manage master products, store codes, barcodes, and supplier mappings."
      >
        <div className="space-y-6">
          <ProductImportStatusBar />

          {!validStoreId ? (
            <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
              <div className="border-b border-zinc-200/80 bg-gradient-to-r from-zinc-50 to-emerald-50/30 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Get started
                </p>
                <h2 className="mt-1 text-lg font-semibold text-zinc-900">Choose a store</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Select a store to browse its catalog. Products load in pages of{" "}
                  {DEFAULT_PAGE_SIZE}–{PAGE_SIZE_OPTIONS.at(-1)}, sorted A–Z.
                </p>
              </div>
              <div className="p-5">
                <ProductFilters stores={stores} departments={departments} />
              </div>
              <div className="border-t border-zinc-200/80 bg-zinc-50/50 px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200/80">
                  <Store className="h-7 w-7 text-emerald-700" aria-hidden />
                </div>
                <p className="mt-4 text-sm font-medium text-zinc-700">
                  No store selected yet
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Pick a store above to search and browse products.
                </p>
              </div>
            </div>
          ) : (
            <ProductCatalogPanel
              stores={stores}
              departments={departments}
              products={products}
              total={total}
              duplicateNames={duplicateNames}
              selectedStore={selectedStore}
              safePage={safePage}
              pageSize={pageSize}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              lineOffset={lineOffset}
              paginationParams={paginationParams}
              search={search}
              activeFilter={params.active}
              departmentFilter={params.department}
            />
          )}

          <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-5 py-4">
              <div className="rounded-lg bg-emerald-100 p-2 text-emerald-800">
                <Package className="h-4 w-4" aria-hidden />
              </div>
              <div>
                <h2 className="font-semibold text-zinc-900">Add or import products</h2>
                <p className="text-sm text-zinc-500">
                  Create a single product or bulk import from Excel.
                </p>
              </div>
            </div>
            <div className="p-5">
              <ProductForms stores={stores} />
            </div>
          </section>
        </div>
      </AppShell>
    </ProductImportProvider>
  );
}
