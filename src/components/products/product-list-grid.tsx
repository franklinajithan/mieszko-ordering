"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, PackageSearch } from "lucide-react";
import { assignOrderDepartment } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import type { ProductRow } from "@/types/product";
import type { DepartmentOption } from "@/types/department";

export const PRODUCT_GRID_COLS =
  "grid-cols-[2.75rem_minmax(5.5rem,7.5rem)_minmax(0,1fr)_minmax(4.5rem,6rem)_minmax(5rem,8rem)_minmax(7.5rem,10rem)_5.5rem_4.5rem]";

export function ProductListGrid({
  products,
  departments,
  duplicateNames,
  lineOffset,
  search,
}: {
  products: ProductRow[];
  departments: DepartmentOption[];
  duplicateNames: Set<string>;
  lineOffset: number;
  search?: string;
}) {
  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="rounded-2xl bg-zinc-100 p-4 text-zinc-500">
          <PackageSearch className="h-8 w-8" aria-hidden />
        </div>
        <p className="mt-4 font-medium text-zinc-900">No products match these filters</p>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          {search
            ? `Nothing found for “${search}”. Try a different search or clear filters.`
            : "Try changing order department or status filters, or import products for this store."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-[58rem]">
      <div
        className={cn(
          "sticky top-0 z-10 grid gap-x-3 border-b border-zinc-200/80 bg-zinc-50/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur-sm",
          PRODUCT_GRID_COLS,
        )}
      >
        <div className="text-right">#</div>
        <div>Code</div>
        <div>Product</div>
        <div className="text-right">Retail</div>
        <div>Imported dept</div>
        <div>Order department</div>
        <div>Status</div>
        <div className="text-right"> </div>
      </div>

      <div className="divide-y divide-zinc-100">
        {products.map(({ product, storeProduct, store }, index) => {
          const isDuplicate = duplicateNames.has(product.name.trim().toLowerCase());
          const lineNumber = lineOffset + index + 1;
          const retailLabel = formatRetailPrice(storeProduct.retailPrice);

          return (
            <div
              key={storeProduct.id}
              className={cn(
                "grid gap-x-3 px-4 py-3 text-sm transition-colors hover:bg-emerald-50/35",
                PRODUCT_GRID_COLS,
                index % 2 === 1 && "bg-zinc-50/40",
              )}
            >
              <div className="self-center text-right tabular-nums text-xs text-zinc-400">
                {lineNumber}
              </div>
              <div className="self-center truncate font-mono text-xs font-medium text-zinc-800">
                {storeProduct.storeProductCode}
              </div>
              <div
                className={cn(
                  "self-center min-w-0 rounded-md px-2 py-1 -mx-2",
                  isDuplicate && "bg-red-50 text-red-900 ring-1 ring-red-100",
                )}
              >
                <p className="truncate font-medium" title={product.name}>
                  {product.name}
                </p>
                {isDuplicate ? (
                  <p className="mt-0.5 text-[11px] font-normal text-red-700/80">
                    Duplicate name
                  </p>
                ) : null}
              </div>
              <div className="self-center text-right tabular-nums text-zinc-700">
                {retailLabel ?? (
                  <span className="text-zinc-300">—</span>
                )}
              </div>
              <div
                className="self-center truncate text-zinc-600"
                title={product.department}
              >
                {product.department}
              </div>
              <div className="self-center">
                <OrderDepartmentSelect
                  productId={product.id}
                  value={product.orderDepartment}
                  departments={departments}
                />
              </div>
              <div className="self-center">
                <Badge status={product.isActive ? "active" : "inactive"}>
                  {product.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="self-center text-right">
                <Link
                  href={`/products/${product.id}?storeId=${store.id}`}
                  className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100/80"
                >
                  Manage
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatRetailPrice(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function OrderDepartmentSelect({
  productId,
  value,
  departments,
}: {
  productId: number;
  value: number | null;
  departments: DepartmentOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={value != null ? String(value) : ""}
      disabled={pending || departments.length === 0}
      className="h-8 text-xs"
      onChange={(event) => {
        const next =
          event.target.value === "" ? null : Number(event.target.value);
        startTransition(async () => {
          await assignOrderDepartment({
            productId,
            orderDepartment: next,
          });
          router.refresh();
        });
      }}
    >
      <option value="">Unassigned</option>
      {departments.map((department) => (
        <option key={department.id} value={String(department.id)}>
          {department.name}
        </option>
      ))}
    </Select>
  );
}
