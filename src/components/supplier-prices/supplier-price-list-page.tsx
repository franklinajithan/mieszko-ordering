"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteSupplierPriceUpload,
  listSupplierPriceUploads,
  type SupplierPriceUploadSummary,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";

export function SupplierPriceListPage({ refreshKey = 0 }: { refreshKey?: number }) {
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [uploads, setUploads] = useState<SupplierPriceUploadSummary[]>([]);
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<SupplierPriceUploadSummary | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadUploads = useCallback(async () => {
    setLoadingUploads(true);
    setListError(null);
    const response = await listSupplierPriceUploads();
    setLoadingUploads(false);
    if (!response.success) {
      setListError(response.error);
      return;
    }
    setUploads(response.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the external upload history after mount or import.
    void loadUploads();
  }, [loadUploads, refreshKey]);

  async function confirmDeleteUpload() {
    const pending = pendingDelete;
    if (!pending) return;
    const deleteKey = `${pending.supplierId}|${pending.importedAt}`;
    setDeletingUpload(deleteKey);
    setListError(null);
    const response = await deleteSupplierPriceUpload(
      pending.supplierId,
      pending.importedAt,
    );
    setDeletingUpload(null);
    setPendingDelete(null);
    if (!response.success) {
      setListError(response.error);
      return;
    }
    await loadUploads();
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-zinc-900">Saved supplier price uploads</h3>
      {loadingUploads ? (
        <p className="text-sm text-zinc-600">Loading…</p>
      ) : uploads.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Uploaded</th>
                <th className="px-3 py-2">Lines</th>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((row) => {
                const deleteKey = `${row.supplierId}|${row.importedAt}`;
                return (
                  <tr
                    key={`${row.supplierId}|${row.importedAt}|${row.effectiveDate}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2 font-medium">
                      {row.supplierName}{" "}
                      <span className="font-normal text-zinc-500">
                        ({row.supplierCode})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {new Date(row.importedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.lineCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {row.fileName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deletingUpload === deleteKey}
                        onClick={() => setPendingDelete(row)}
                      >
                        {deletingUpload === deleteKey ? "Deleting…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          No supplier price uploads yet. Import a file to add data.
        </p>
      )}
      {listError ? <p className="text-sm text-red-600">{listError}</p> : null}

      <ConfirmAlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingUpload) setPendingDelete(null);
        }}
        title="Delete supplier price upload?"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.lineCount.toLocaleString()} price line(s) for ${pendingDelete.supplierName} (${pendingDelete.supplierCode}) imported ${new Date(pendingDelete.importedAt).toLocaleString()}?`
            : ""
        }
        confirming={Boolean(
          pendingDelete &&
            deletingUpload ===
              `${pendingDelete.supplierId}|${pendingDelete.importedAt}`,
        )}
        onConfirm={() => void confirmDeleteUpload()}
      />
    </section>
  );
}
