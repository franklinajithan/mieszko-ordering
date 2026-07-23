import { Building2, Copy, Layers } from "lucide-react";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductListGrid } from "@/components/products/product-list-grid";
import { ProductPagination } from "@/components/products/product-pagination";

type Store = { id: number; name: string; code: string; erpType?: string };

type ProductRow = {
  product: {
    id: number;
    name: string;
    department: string;
    isActive: boolean;
  };
  storeProduct: {
    id: number;
    storeProductCode: string;
  };
  store: {
    id: number;
    name: string;
  };
};

export function ProductCatalogPanel({
  stores,
  departments,
  products,
  total,
  duplicateNames,
  selectedStore,
  safePage,
  pageSize,
  pageSizeOptions,
  lineOffset,
  paginationParams,
  search,
  activeFilter,
  departmentFilter,
}: {
  stores: Store[];
  departments: string[];
  products: ProductRow[];
  total: number;
  duplicateNames: Set<string>;
  selectedStore: Store | undefined;
  safePage: number;
  pageSize: number;
  pageSizeOptions: number[];
  lineOffset: number;
  paginationParams: Record<string, string | undefined>;
  search?: string;
  activeFilter?: string;
  departmentFilter?: string;
}) {
  const erpLabel = selectedStore?.erpType === "glopos" ? "GloPOS" : "MSP";

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
      <div className="border-b border-zinc-200/80 bg-gradient-to-r from-zinc-50 via-white to-emerald-50/40 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Product catalog
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {selectedStore?.name ?? "Store catalog"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {selectedStore?.code} · {erpLabel} · sorted A–Z by name
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatPill
              icon={Layers}
              label="Products"
              value={total.toLocaleString()}
              tone="emerald"
            />
            {duplicateNames.size > 0 ? (
              <StatPill
                icon={Copy}
                label="Duplicates"
                value={String(duplicateNames.size)}
                tone="red"
              />
            ) : null}
            <StatPill
              icon={Building2}
              label="Store"
              value={selectedStore?.code ?? "—"}
              tone="zinc"
            />
          </div>
        </div>
      </div>

      <div className="border-b border-zinc-200/80 bg-white px-4 py-4 sm:px-5">
        <ProductFilters
          stores={stores}
          departments={departments}
          variant="catalog"
          activeDepartment={departmentFilter}
          activeStatus={activeFilter}
          activeSearch={search}
        />
      </div>

      <div className="overflow-x-auto">
        <ProductListGrid
          products={products}
          duplicateNames={duplicateNames}
          lineOffset={lineOffset}
          search={search}
        />
      </div>

      <div className="border-t border-zinc-200/80 bg-zinc-50/60 px-4 py-3 sm:px-5">
        <ProductPagination
          page={safePage}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          total={total}
          searchParams={paginationParams}
        />
      </div>
    </section>
  );
}

function StatPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "emerald" | "red" | "zinc";
}) {
  const tones = {
    emerald: "border-emerald-200/80 bg-emerald-50/80 text-emerald-900",
    red: "border-red-200/80 bg-red-50/80 text-red-900",
    zinc: "border-zinc-200/80 bg-white text-zinc-700",
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${tones[tone]}`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <p className="font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}
