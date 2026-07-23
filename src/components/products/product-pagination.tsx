import Link from "next/link";

export function ProductPagination({
  page,
  pageSize,
  total,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  function hrefFor(nextPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `/products?${query}` : "/products";
  }

  if (totalPages <= 1) {
    return (
      <p className="text-sm text-zinc-500">
        Showing {total.toLocaleString()} product{total === 1 ? "" : "s"}
      </p>
    );
  }

  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-zinc-500">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        {safePage > 1 ? (
          <Link
            href={hrefFor(safePage - 1)}
            className="rounded-md border px-3 py-1.5 hover:bg-zinc-50"
          >
            Previous
          </Link>
        ) : (
          <span className="rounded-md border px-3 py-1.5 text-zinc-300">Previous</span>
        )}
        <span className="text-zinc-600">
          Page {safePage} of {totalPages}
        </span>
        {safePage < totalPages ? (
          <Link
            href={hrefFor(safePage + 1)}
            className="rounded-md border px-3 py-1.5 hover:bg-zinc-50"
          >
            Next
          </Link>
        ) : (
          <span className="rounded-md border px-3 py-1.5 text-zinc-300">Next</span>
        )}
      </div>
    </div>
  );
}
