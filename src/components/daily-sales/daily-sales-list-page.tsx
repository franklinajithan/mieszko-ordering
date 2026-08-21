"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteDailySalesUpload, listDailySalesSummaries } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { DailySalesUploadRow } from "@/components/daily-sales/types";
import type { StoreOption } from "@/types/store";

export function DailySalesListPage({
  storeId,
  stores,
  refreshKey = 0,
}: {
  storeId: string;
  stores: StoreOption[];
  refreshKey?: number;
}) {
  const [loadingRows, setLoadingRows] = useState(false);
  const [uploadRows, setUploadRows] = useState<DailySalesUploadRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DailySalesUploadRow | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const loadUploadRows = useCallback(
    async (forStoreId: string, requestedPage = page) => {
      if (!forStoreId) {
        setUploadRows([]);
        setTotalRows(0);
        return;
      }
      setLoadingRows(true);
      setError(null);
      const response = await listDailySalesSummaries(
        Number(forStoreId),
        requestedPage,
        pageSize,
      );
      setLoadingRows(false);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const store = stores.find((s) => String(s.id) === forStoreId);
      setUploadRows(
        response.data.rows.map((row) => ({
          id: `${forStoreId}|${row.salesDate}`,
          storeId: forStoreId,
          storeName: store?.name ?? "",
          salesDate: row.salesDate,
          matchedRows: row.itemCount,
          totalSoldQty: row.totalSoldQty,
          uploadedAt: new Date(row.lastUpdated),
        })),
      );
      setTotalRows(response.data.total);
    },
    [page, pageSize, stores],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadUploadRows(storeId));
  }, [storeId, page, refreshKey, loadUploadRows]);

  async function confirmDelete() {
    const row = pendingDelete;
    if (!row) return;
    setDeletingId(row.id);
    setError(null);
    const response = await deleteDailySalesUpload(
      Number(row.storeId),
      row.salesDate,
    );
    setDeletingId(null);
    setPendingDelete(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const lastPage = Math.max(1, Math.ceil((totalRows - 1) / pageSize));
    const nextPage = Math.min(page, lastPage);
    if (nextPage !== page) setPage(nextPage);
    else await loadUploadRows(row.storeId, nextPage);
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-900">Saved daily sales</h3>
      {!storeId ? (
        <p className="text-sm text-zinc-600">
          Select a store to see sales dates already in the database.
        </p>
      ) : loadingRows ? (
        <p className="text-sm text-zinc-600">Loading…</p>
      ) : uploadRows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-3 py-2">Sales date</th>
                <th className="px-3 py-2">Products saved</th>
                <th className="px-3 py-2">Sold qty</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {uploadRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.salesDate}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.matchedRows.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDecimal(parseDbDecimal(row.totalSoldQty), 2)}
                  </td>
                  <td className="px-3 py-2">
                    {row.uploadedAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={deletingId === row.id}
                      onClick={() => setPendingDelete(row)}
                    >
                      {deletingId === row.id ? "Deleting…" : "Delete"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          No daily sales saved for this store yet. Import a file to add data.
        </p>
      )}
      {totalRows > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-zinc-600">
            Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
            {totalRows.toLocaleString()} sales dates
          </p>
          <div className="flex items-center gap-2">
            <label className="text-zinc-600">
              Per page{" "}
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1"
              >
                {[10, 25, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingRows || page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <span className="text-zinc-600">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingRows || page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <ConfirmAlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPendingDelete(null);
        }}
        title="Delete daily sales?"
        description={
          pendingDelete
            ? `Delete all saved daily sales for ${pendingDelete.storeName} on ${pendingDelete.salesDate}?`
            : ""
        }
        confirming={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
