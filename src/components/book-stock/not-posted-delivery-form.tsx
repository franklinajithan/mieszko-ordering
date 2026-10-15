"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import {
  deleteNotPostedUpload,
  importNotPostedFiles,
  listNotPostedImports,
  type NotPostedImportFileResult,
  type NotPostedUploadSummary,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { ImportProgressBar } from "@/components/ui/import-progress-bar";

export function NotPostedDeliveryForm({
  storeId,
  storeName,
  onChanged,
  embedded = false,
}: {
  storeId: number | null;
  storeName?: string;
  onChanged?: () => void;
  embedded?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<NotPostedUploadSummary[]>([]);
  const [results, setResults] = useState<NotPostedImportFileResult[] | null>(null);
  const [partialErrors, setPartialErrors] = useState<
    Array<{ fileName: string; error: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [pickerKey, setPickerKey] = useState(0);
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NotPostedUploadSummary | null>(
    null,
  );
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    fileName: string;
    done: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const request = storeId ? listNotPostedImports(storeId) : Promise.resolve({ success: true as const, data: [] });
    void request.then(response => {
      if (!cancelled) setUploads(response.success ? response.data : []);
    });
    return () => { cancelled = true; };
  }, [storeId, listRefreshKey]);

  const totalRecQty = useMemo(
    () =>
      uploads.reduce(
        (sum, entry) => sum + Number(parseDbDecimal(entry.totalQty)),
        0,
      ),
    [uploads],
  );

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setResults(null);
    setPartialErrors([]);
    setError(null);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setPickerKey((key) => key + 1);
  }

  async function onImport() {
    if (!storeId) {
      setError("Select a store first.");
      return;
    }
    if (!files.length) {
      setError("Choose one or more not-posted delivery files.");
      return;
    }
    setImporting(true);
    setError(null);
    setResults(null);
    setPartialErrors([]);
    const imported: NotPostedImportFileResult[] = [];
    const failed: Array<{ fileName: string; error: string }> = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress({
          processed: index,
          total: files.length,
          fileName: file.name,
          done: false,
        });
        const response = await importNotPostedFiles(storeId, [file]);
        if (!response.success) {
          failed.push({ fileName: file.name, error: response.error });
          continue;
        }
        imported.push(...response.data.results);
        failed.push(...response.data.errors);
      }
      setProgress({
        processed: files.length,
        total: files.length,
        fileName: files[files.length - 1]?.name ?? "",
        done: true,
      });
      if (!imported.length) {
        setProgress(null);
        setError(
          failed.map((entry) => `${entry.fileName}: ${entry.error}`).join(" ") ||
            "No delivery files were imported.",
        );
        setPartialErrors(failed);
        return;
      }
      setResults(imported);
      setPartialErrors(failed);
      setFiles([]);
      setPickerKey((key) => key + 1);
      setListRefreshKey((key) => key + 1);
      onChanged?.();
      window.setTimeout(() => setProgress(null), 800);
    } catch (cause) {
      setProgress(null);
      setError(
        cause instanceof Error ? cause.message : "Failed to import not-posted files.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function confirmDeleteUpload() {
    if (!pendingDelete || !storeId) return;
    setDeletingUpload(pendingDelete.importedAt);
    setError(null);
    const response = await deleteNotPostedUpload(storeId, pendingDelete.importedAt);
    setDeletingUpload(null);
    setPendingDelete(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setListRefreshKey((key) => key + 1);
    onChanged?.();
  }

  return (
    <section
      className={
        embedded
          ? "space-y-4"
          : "space-y-4 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {embedded ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-zinc-900">Not-posted deliveries</h3>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                Optional
              </span>
            </div>
          )}
          <p className="text-sm text-zinc-600">
            Upload not-posted files when you create this order.{" "}
            <strong>Item Code</strong> + <strong>Rec Total Unit</strong> are
            added for this generate only. They are not reused next time — upload
            again if needed.
          </p>
        </div>
        {storeId && uploads.length ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800">
              For this generate
            </p>
            <p className="text-sm font-semibold tabular-nums text-emerald-950">
              {formatDecimal(totalRecQty, 2)}{" "}
              <span className="text-xs font-medium text-emerald-800">
                · {uploads.length} file{uploads.length === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <FileUploadField
            key={`${storeId ?? "none"}-${pickerKey}`}
            name="files"
            accept=".csv,.xlsx,.xls"
            multiple
            disabled={!storeId || importing}
            hint={
              storeId
                ? "Select one or more .xlsx or .csv files"
                : "Select a store above first"
            }
            onChange={onFileChange}
          />
          {files.length ? (
            <ul className="space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">
                    {file.name}
                  </span>
                  <button
                    type="button"
                    className="rounded-md p-1 text-zinc-400 hover:bg-white hover:text-zinc-700"
                    aria-label={`Remove ${file.name}`}
                    disabled={importing}
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            onClick={() => void onImport()}
            disabled={!storeId || importing || !files.length}
          >
            {importing ? "Importing…" : "Import delivery files"}
          </Button>
        </div>

        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-600">
          {progress ? (
            <ImportProgressBar
              label={
                progress.done
                  ? "Not-posted import complete"
                  : "Saving not-posted deliveries…"
              }
              detail={`${progress.fileName}${storeName ? ` · ${storeName}` : ""}`}
              processed={progress.processed}
              total={progress.total}
              done={progress.done}
            />
          ) : results?.length ? (
            <div className="space-y-3">
              <h4 className="font-semibold text-zinc-900">Last import</h4>
              {results.map((result) => (
                <div key={`${result.fileName}-${result.importedAt}`} className="space-y-2">
                  <p className="font-medium text-zinc-800">{result.fileName}</p>
                  <ImportSummary result={result} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <h4 className="font-semibold text-zinc-800">How this is used</h4>
              <ol className="list-decimal space-y-1.5 pl-4">
                <li>
                  Match each row by <strong>Item Code</strong> to the store
                  product.
                </li>
                <li>
                  Take <strong>Rec Total Unit</strong> as the received quantity.
                </li>
                <li>
                  Upload them on this order. Generate uses these files once.
                </li>
                <li>
                  After generate they are cleared. A new book-stock file also
                  clears leftover files. Upload again on the next order.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {storeId ? (
        uploads.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-600">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Uploaded at</th>
                  <th className="px-3 py-2 text-right">Products</th>
                  <th className="px-3 py-2 text-right">Rec total qty</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((entry) => (
                  <tr key={`${entry.fileName}-${entry.importedAt}`} className="border-t">
                    <td className="px-3 py-2 font-medium">{entry.fileName}</td>
                    <td className="px-3 py-2 text-zinc-600">
                      {new Date(entry.importedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entry.itemCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDecimal(parseDbDecimal(entry.totalQty), 2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deletingUpload === entry.importedAt}
                        onClick={() => setPendingDelete(entry)}
                      >
                        {deletingUpload === entry.importedAt ? "Deleting…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            No not-posted files for this generate. Upload them here if stock has
            arrived but is not posted yet.
          </p>
        )
      ) : (
        <p className="text-sm text-zinc-500">
          Select a store to upload or review not-posted delivery files.
        </p>
      )}

      {partialErrors.map((entry) => (
        <p key={entry.fileName} className="text-sm text-red-600">
          {entry.fileName}: {entry.error}
        </p>
      ))}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <ConfirmAlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingUpload) setPendingDelete(null);
        }}
        title="Delete not-posted delivery file?"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.fileName} for ${storeName ?? "this store"}? It will not be added on this generate.`
            : ""
        }
        confirming={Boolean(
          pendingDelete && deletingUpload === pendingDelete.importedAt,
        )}
        onConfirm={() => void confirmDeleteUpload()}
      />
    </section>
  );
}
