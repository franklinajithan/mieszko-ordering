"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteRtcUpload, listRtcSummaries } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { RtcSavedRow } from "@/components/rtc-sales/types";
import type { StoreOption } from "@/types/store";

export function RtcSalesListPage({
  storeId,
  stores,
  refreshKey = 0,
}: {
  storeId: string;
  stores: StoreOption[];
  refreshKey?: number;
}) {
  const [loadingRows, setLoadingRows] = useState(false);
  const [savedRows, setSavedRows] = useState<RtcSavedRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSavedRows = useCallback(async (forStoreId: string) => {
    if (!forStoreId) {
      setSavedRows([]);
      return;
    }
    setLoadingRows(true);
    setError(null);
    const response = await listRtcSummaries(Number(forStoreId));
    setLoadingRows(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const store = stores.find((s) => String(s.id) === forStoreId);
    setSavedRows(
      response.data.map((row) => ({
        id: `${forStoreId}|${row.rtcDate}`,
        storeId: forStoreId,
        storeName: store?.name ?? "",
        rtcDate: row.rtcDate,
        productCount: row.itemCount,
        totalRtcQty: row.totalRtcQty,
        lastUpdated: new Date(row.lastUpdated),
      })),
    );
  }, [stores]);

  useEffect(() => {
    void loadSavedRows(storeId);
  }, [storeId, refreshKey, loadSavedRows]);

  async function onDeleteRow(row: RtcSavedRow) {
    if (
      !window.confirm(
        `Delete all saved RTC data for ${row.storeName} on ${row.rtcDate}?`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    const response = await deleteRtcUpload(Number(row.storeId), row.rtcDate);
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSavedRows(row.storeId);
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-900">Saved RTC data</h3>
      {!storeId ? (
        <p className="text-sm text-zinc-600">
          Select a store to see RTC dates already saved.
        </p>
      ) : loadingRows ? (
        <p className="text-sm text-zinc-600">Loading…</p>
      ) : savedRows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-3 py-2">RTC date</th>
                <th className="px-3 py-2">Products saved</th>
                <th className="px-3 py-2">RTC qty</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.rtcDate}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.productCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDecimal(parseDbDecimal(row.totalRtcQty), 2)}
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
          No RTC data saved for this store yet. Import a file to add data.
        </p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
