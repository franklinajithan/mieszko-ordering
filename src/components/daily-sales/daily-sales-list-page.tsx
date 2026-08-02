"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteDailySalesUpload, listDailySalesSummaries } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { DailySalesUploadRow, Store } from "@/types/daily-sales";

export function DailySalesListPage({
  storeId,
  stores,
  refreshKey = 0,
}: {
  storeId: string;
  stores: Store[];
  refreshKey?: number;
}) {
  const [loadingRows, setLoadingRows] = useState(false);
  const [uploadRows, setUploadRows] = useState<DailySalesUploadRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUploadRows = useCallback(
    async (forStoreId: string) => {
      if (!forStoreId) {
        setUploadRows([]);
        return;
      }
      setLoadingRows(true);
      setError(null);
      const response = await listDailySalesSummaries(Number(forStoreId));
      setLoadingRows(false);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const store = stores.find((s) => String(s.id) === forStoreId);
      setUploadRows(
        response.data.map((row) => ({
          id: `${forStoreId}|${row.salesDate}`,
          storeId: forStoreId,
          storeName: store?.name ?? "",
          salesDate: row.salesDate,
          matchedRows: row.itemCount,
          totalSoldQty: row.totalSoldQty,
          uploadedAt: new Date(row.lastUpdated),
        })),
      );
    },
    [stores],
  );

  useEffect(() => {
    void loadUploadRows(storeId);
  }, [storeId, refreshKey, loadUploadRows]);

  async function onDeleteRow(row: DailySalesUploadRow) {
    if (
      !window.confirm(
        `Delete all saved daily sales for ${row.storeName} on ${row.salesDate}?`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    const response = await deleteDailySalesUpload(
      Number(row.storeId),
      row.salesDate,
    );
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadUploadRows(row.storeId);
  }

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
                      onClick={() => onDeleteRow(row)}
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
