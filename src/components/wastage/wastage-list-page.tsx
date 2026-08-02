"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteWastageUpload, listWastageSummaries } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { Store, WastageSavedRow } from "@/types/wastage";

export function WastageListPage({
  storeId,
  stores,
  refreshKey = 0,
}: {
  storeId: string;
  stores: Store[];
  refreshKey?: number;
}) {
  const [loadingRows, setLoadingRows] = useState(false);
  const [savedRows, setSavedRows] = useState<WastageSavedRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSavedRows = useCallback(
    async (forStoreId: string) => {
      if (!forStoreId) {
        setSavedRows([]);
        return;
      }
      setLoadingRows(true);
      setError(null);
      const response = await listWastageSummaries(Number(forStoreId));
      setLoadingRows(false);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const store = stores.find((s) => String(s.id) === forStoreId);
      setSavedRows(
        response.data.map((row) => ({
          id: `${forStoreId}|${row.wastageDate}`,
          storeId: forStoreId,
          storeName: store?.name ?? "",
          wastageDate: row.wastageDate,
          productCount: row.itemCount,
          totalWastageQty: row.totalWastageQty,
          lastUpdated: new Date(row.lastUpdated),
        })),
      );
    },
    [stores],
  );

  useEffect(() => {
    void loadSavedRows(storeId);
  }, [storeId, refreshKey, loadSavedRows]);

  async function onDeleteRow(row: WastageSavedRow) {
    if (
      !window.confirm(
        `Delete all saved wastage data for ${row.storeName} on ${row.wastageDate}?`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    const response = await deleteWastageUpload(
      Number(row.storeId),
      row.wastageDate,
    );
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSavedRows(row.storeId);
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-900">Saved wastage data</h3>
      {!storeId ? (
        <p className="text-sm text-zinc-600">
          Select a store to see wastage dates already saved.
        </p>
      ) : loadingRows ? (
        <p className="text-sm text-zinc-600">Loading…</p>
      ) : savedRows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-3 py-2">Wastage date</th>
                <th className="px-3 py-2">Products saved</th>
                <th className="px-3 py-2">Wastage qty</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.wastageDate}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.productCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDecimal(parseDbDecimal(row.totalWastageQty), 2)}
                  </td>
                  <td className="px-3 py-2">
                    {row.lastUpdated.toLocaleString()}
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
          No wastage data saved for this store yet. Import a file to add data.
        </p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
