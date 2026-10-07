"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import {
  deleteFutureUpload,
  importFutureFiles,
  listFutureImports,
  type FutureImportFileResult,
  type FutureUploadSummary,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { ImportProgressBar } from "@/components/ui/import-progress-bar";
import { cn } from "@/utils/cn";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { Supplier } from "@/types/supplier";

export type FutureDeliverySource = "ocs" | "order" | "invoice";

const SOURCES: Array<{
  id: FutureDeliverySource;
  label: string;
}> = [
  { id: "ocs", label: "OCS" },
  { id: "order", label: "Order" },
  { id: "invoice", label: "Invoice" },
];

export function FutureDeliveriesForm({
  storeId,
  storeName,
  suppliers,
  embedded = false,
  onChanged,
}: {
  storeId: number | null;
  storeName?: string;
  suppliers: Supplier[];
  embedded?: boolean;
  onChanged?: () => void;
}) {
  const [source, setSource] = useState<FutureDeliverySource>("ocs");
  const [supplierId, setSupplierId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<FutureUploadSummary[]>([]);
  const [results, setResults] = useState<FutureImportFileResult[] | null>(null);
  const [partialErrors, setPartialErrors] = useState<
    Array<{ fileName: string; error: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [pickerKey, setPickerKey] = useState(0);
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FutureUploadSummary | null>(
    null,
  );
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    fileName: string;
    done: boolean;
  } | null>(null);

  const needsSupplier = source === "order" || source === "invoice";
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );
  const selectedSupplier = activeSuppliers.find(
    (supplier) => String(supplier.id) === supplierId,
  );
  const canImport =
    Boolean(storeId) &&
    files.length > 0 &&
    (source === "ocs" || (needsSupplier && Boolean(supplierId)));

  const totalQty = useMemo(
    () =>
      uploads.reduce(
        (sum, entry) => sum + Number(parseDbDecimal(entry.totalQty)),
        0,
      ),
    [uploads],
  );

  useEffect(() => {
    if (!storeId) {
      setUploads([]);
      return;
    }
    void listFutureImports(storeId).then((response) => {
      if (response.success) setUploads(response.data);
      else setUploads([]);
    });
  }, [storeId, listRefreshKey]);

  function onSourceChange(next: FutureDeliverySource) {
    setSource(next);
    setFiles([]);
    setPickerKey((key) => key + 1);
    setError(null);
    setResults(null);
    if (next === "ocs") setSupplierId("");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
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
    if (needsSupplier && !supplierId) {
      setError("Select a supplier before uploading this file.");
      return;
    }
    if (!files.length) {
      setError("Choose one or more future delivery files.");
      return;
    }
    setImporting(true);
    setError(null);
    setResults(null);
    setPartialErrors([]);
    const imported: FutureImportFileResult[] = [];
    const failed: Array<{ fileName: string; error: string }> = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress({
          processed: index,
          total: files.length,
          fileName: file.name,
          done: false,
        });
        const response = await importFutureFiles(
          storeId,
          [file],
          source,
          needsSupplier ? Number(supplierId) : undefined,
        );
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
            "No future delivery files were imported.",
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
        cause instanceof Error ? cause.message : "Failed to import future delivery files.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function confirmDeleteUpload() {
    if (!pendingDelete || !storeId) return;
    setDeletingUpload(pendingDelete.importedAt);
    setError(null);
    const response = await deleteFutureUpload(storeId, pendingDelete.importedAt);
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
      {embedded ? (
        <p className="text-sm text-zinc-600">
          Upload future files when you generate. Saved files are added on top of
          the current book stock, including invoices matched by{" "}
          <strong>INDEKS</strong>. Accepts <strong>.xlsx</strong>,{" "}
          <strong>.xls</strong>, and <strong>.csv</strong>.
        </p>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-zinc-900">Future deliveries</h3>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                Optional
              </span>
            </div>
            <p className="text-sm text-zinc-600">
              Upload when you generate. OCS, order, and invoice files are all
              added to current qty. They are not tied to a book-stock time.
              Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, and{" "}
              <strong>.csv</strong>.
            </p>
          </div>
          {storeId && uploads.length ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800">
                Added on generate
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-950">
                {formatDecimal(totalQty, 2)}{" "}
                <span className="text-xs font-medium text-emerald-800">
                  · {uploads.length} file{uploads.length === 1 ? "" : "s"}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div
        className="grid grid-cols-3 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        role="tablist"
        aria-label="Future delivery source"
      >
        {SOURCES.map((option, index) => {
          const selected = source === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={importing}
              onClick={() => {
                if (!importing) onSourceChange(option.id);
              }}
              className={cn(
                "border-b-2 px-3 py-2.5 text-left transition-colors",
                index > 0 && "border-l border-l-zinc-200",
                selected
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
              )}
            >
              <span
                className={cn(
                  "block text-sm font-semibold",
                  selected ? "text-emerald-900" : "text-zinc-700",
                )}
              >
                {option.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {option.id === "ocs"
                  ? "Item Code + Del Total Unit"
                  : option.id === "order"
                    ? "Index + Ordered number"
                    : "INDEKS + ILOSC"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {needsSupplier ? (
            <div>
              <Label>Supplier</Label>
              <Select
                value={supplierId}
                disabled={!storeId || importing}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  setError(null);
                }}
              >
                <option value="" disabled>
                  Select supplier
                </option>
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.code} — {supplier.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-zinc-500">
                Required. Rows are matched by{" "}
                <strong>{source === "invoice" ? "INDEKS" : "Index"}</strong> to
                this supplier’s codes.
              </p>
            </div>
          ) : null}

          <FileUploadField
            key={`${storeId ?? "none"}-${source}-${pickerKey}`}
            name="future-files"
            accept=".csv,.xlsx,.xls"
            multiple
            disabled={!storeId || importing || (needsSupplier && !supplierId)}
            hint={
              !storeId
                ? "Select a store above first"
                : needsSupplier && !supplierId
                  ? "Select a supplier first"
                  : "Select one or more .xlsx, .xls, or .csv files"
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
            disabled={!canImport || importing}
          >
            {importing ? "Importing…" : "Import future deliveries"}
          </Button>
          {storeName && source === "ocs" ? (
            <p className="text-xs text-zinc-500">{storeName} · OCS</p>
          ) : null}
          {storeName && selectedSupplier ? (
            <p className="text-xs text-zinc-500">
              {storeName} · {selectedSupplier.code} · {sourceLabel(source)}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-600">
          {progress ? (
            <ImportProgressBar
              label={
                progress.done
                  ? "Future delivery import complete"
                  : "Saving future deliveries…"
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
              <h4 className="font-semibold text-zinc-800">
                {source === "ocs"
                  ? "OCS file"
                  : source === "order"
                    ? "Order file"
                    : "Invoice file"}
              </h4>
              <ol className="list-decimal space-y-1.5 pl-4">
                {source === "ocs" ? (
                  <>
                    <li>
                      Match <strong>Item Code</strong> to the store product.
                    </li>
                    <li>
                      Take <strong>Del Total Unit</strong> as the future quantity.
                    </li>
                    <li>No supplier is needed.</li>
                  </>
                ) : source === "order" ? (
                  <>
                    <li>Select SP, WAB, or MM before choosing a file.</li>
                    <li>
                      Match <strong>Index</strong> to that supplier’s code.
                    </li>
                    <li>
                      Take <strong>Ordered number</strong> as the future
                      quantity. Excel and CSV both work.
                    </li>
                  </>
                ) : (
                  <>
                    <li>Select SP, WAB, or MM before choosing a file.</li>
                    <li>
                      Match <strong>INDEKS</strong> to that supplier’s code.
                    </li>
                    <li>
                      Take <strong>ILOSC</strong> as the future quantity. Excel
                      and CSV both work, including older <strong>.xls</strong>{" "}
                      invoices.
                    </li>
                  </>
                )}
                <li>You can upload several files. All are added on generate.</li>
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
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Uploaded at</th>
                  <th className="px-3 py-2 text-right">Products</th>
                  <th className="px-3 py-2 text-right">Del total qty</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((entry) => (
                  <tr key={`${entry.fileName}-${entry.importedAt}`} className="border-t">
                    <td className="px-3 py-2 font-medium">{entry.fileName}</td>
                    <td className="px-3 py-2 uppercase text-zinc-600">{entry.source}</td>
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
            No future delivery files for this store. Upload them when you
            generate if stock is due in.
          </p>
        )
      ) : (
        <p className="text-sm text-zinc-500">
          Select a store to upload or review future delivery files.
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
        title="Delete future delivery file?"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.fileName} for ${storeName ?? "this store"}? Those quantities will no longer be added on generate.`
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

function sourceLabel(source: FutureDeliverySource): string {
  if (source === "ocs") return "OCS";
  if (source === "order") return "Order";
  return "Invoice";
}
