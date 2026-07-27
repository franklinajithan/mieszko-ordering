import { Package, Store } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProductCatalogPanel } from "@/components/products/product-catalog-panel";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductForms } from "@/components/products/product-forms";
import {
  ProductImportProvider,
  ProductImportStatusBar,
} from "@/components/products/product-import-context";
import type { ProductsPageProps } from "@/types/product";

export type { ProductsPageProps };

export function ProductsPageView({
  stores,
  departments,
  products,
  total,
  duplicateNames,
  selectedStore,
  validStoreId,
  safePage,
  pageSize,
  pageSizeOptions,
  defaultPageSize,
  lineOffset,
  paginationParams,
  search,
  activeFilter,
  departmentFilter,
}: ProductsPageProps) {
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
                <h2 className="mt-1 text-lg font-semibold text-zinc-900">
                  Choose a store
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Select a store to browse its catalog. Products load in pages of{" "}
                  {defaultPageSize}–{pageSizeOptions.at(-1)}, sorted A–Z.
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
              pageSizeOptions={pageSizeOptions}
              lineOffset={lineOffset}
              paginationParams={paginationParams}
              search={search}
              activeFilter={activeFilter}
              departmentFilter={departmentFilter}
            />
          )}

          <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-5 py-4">
              <div className="rounded-lg bg-emerald-100 p-2 text-emerald-800">
                <Package className="h-4 w-4" aria-hidden />
              </div>
              <div>
                <h2 className="font-semibold text-zinc-900">
                  Add or import products
                </h2>
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
