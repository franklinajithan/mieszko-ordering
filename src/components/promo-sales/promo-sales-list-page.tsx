"use client";

import { useCallback, useEffect, useState } from "react";
import { deletePromoUpload, listPromoSummaries } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { PromoSavedRow } from "@/components/promo-sales/types";
import type { StoreOption } from "@/types/store";

export function PromoSalesListPage({
  storeId,
  stores,
  refreshKey = 0,
}: {
  storeId: string;
  stores: StoreOption[];
  refreshKey?: number;
}) {
  const [loadingRows, setLoadingRows] = useState(false);
  const [savedRows, setSavedRows] = useState<PromoSavedRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PromoSavedRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSavedRows = useCallback(
    async (forStoreId: string) => {
      if (!forStoreId) {
        setSavedRows([]);
        return;
      }
      setLoadingRows(true);
      setError(null);
      const response = await listPromoSummaries(Number(forStoreId));
      setLoadingRows(false);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const store = stores.find((s) => String(s.id) === forStoreId);
      setSavedRows(
        response.data.map((row) => ({
          id: `${forStoreId}|${row.promoDate}`,
          storeId: forStoreId,
          storeName: store?.name ?? "",
          promoDate: row.promoDate,
          productCount: row.itemCount,
          totalPromoQty: row.totalPromoQty,
          lastUpdated: new Date(row.lastUpdated),
        })),
      );
    },
    [stores],
  );

  useEffect(() => {
    void loadSavedRows(storeId);
  }, [storeId, refreshKey, loadSavedRows]);

  async function confirmDelete() {
    const row = pendingDelete;
    if (!row) return;
    setDeletingId(row.id);
    setError(null);
    const response = await deletePromoUpload(Number(row.storeId), row.promoDate);
    setDeletingId(null);
    setPendingDelete(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSavedRows(row.storeId);
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-900">Saved promo data</h3>
      {!storeId ? (
        <p className="text-sm text-zinc-600">
          Select a store to see promo dates already saved.
        </p>
      ) : loadingRows ? (
        <p className="text-sm text-zinc-600">Loading…</p>
      ) : savedRows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-3 py-2">Promo date</th>
                <th className="px-3 py-2">Products saved</th>
                <th className="px-3 py-2">Promo qty</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.promoDate}</td>
                  <td className="px-3 py-2">{row.productCount}</td>
                  <td className="px-3 py-2">
                    {formatDecimal(parseDbDecimal(row.totalPromoQty), 3)}
                  </td>
                  <td className="px-3 py-2">
                    {row.lastUpdated.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
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
        <p className="text-sm text-zinc-600">No promo data saved for this store yet.</p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <ConfirmAlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPendingDelete(null);
        }}
        title="Delete promo data?"
        description={
          pendingDelete
            ? `Delete all saved promo data for ${pendingDelete.storeName} on ${pendingDelete.promoDate}?`
            : ""
        }
        confirming={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
