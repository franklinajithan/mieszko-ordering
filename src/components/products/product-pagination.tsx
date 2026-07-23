"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/input";

export function ProductPagination({
  page,
  pageSize,
  pageSizeOptions,
  total,
  searchParams,
}: {
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  total: number;
  searchParams: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  function hrefFor(nextPage: number, nextPageSize = pageSize) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    if (nextPageSize === pageSizeOptions[0]) params.delete("pageSize");
    else params.set("pageSize", String(nextPageSize));
    const query = params.toString();
    return query ? `/products?${query}` : "/products";
  }

  function onPageSizeChange(nextPageSize: string) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    params.delete("page");
    if (Number(nextPageSize) === pageSizeOptions[0]) params.delete("pageSize");
    else params.set("pageSize", nextPageSize);
    const query = params.toString();
    router.push(query ? `/products?${query}` : "/products");
  }

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <p className="text-zinc-600">
        {total === 0 ? (
          "No products"
        ) : (
          <>
            Showing{" "}
            <span className="font-medium text-zinc-900">
              {from.toLocaleString()}–{to.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-medium text-zinc-900">{total.toLocaleString()}</span>
            {totalPages > 1 ? (
              <>
                {" "}
                · Page{" "}
                <span className="font-medium text-zinc-900">
                  {safePage} of {totalPages}
                </span>
              </>
            ) : null}
          </>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-zinc-500">Per page</Label>
          <Select
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(e.target.value)}
            className="mt-1 min-w-24"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option.toLocaleString()}
              </option>
            ))}
          </Select>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center gap-2 pb-0.5">
            {safePage > 1 ? (
              <Link
                href={hrefFor(safePage - 1)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-zinc-300">
                Previous
              </span>
            )}
            {safePage < totalPages ? (
              <Link
                href={hrefFor(safePage + 1)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-zinc-100 px-3 py-1.5 text-zinc-300">
                Next
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
