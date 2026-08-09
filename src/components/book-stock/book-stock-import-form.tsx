"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  BOOK_STOCK_IMPORT_CHUNK_SIZE,
  deleteBookStockUpload,
  importBookStockChunk,
  listBookStockImports,
  parseBookStockFile,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { parseBookStockFileBuffer } from "@/parsers/book-stock/book-stock-file-parser";
import {
  prepareBookStockImport,
  resolveBookStockColumns,
} from "@/services/book-stock/book-stock-import-prepare";
import { BOOK_STOCK_COLUMNS } from "@/lib/import-config";
import type { ErpType, ImportResult } from "@/types";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import type {
  BookStockImportProgress,
  BookStockPreviewState,
  BookStockUploadSummary,
} from "@/components/book-stock/types";

function toDatetimeLocalValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Prefer `_YYYYMMDD_HHMMSS` from Stock Valuation filenames; fall back to date-only + now time. */
function datetimeLocalFromFile(fileName: string, bookStockDate?: string): string {
  const withTime = fileName.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (withTime) {
    const [, yyyy, mm, dd, hh, min] = withTime;
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  if (bookStockDate && /^\d{4}-\d{2}-\d{2}$/.test(bookStockDate)) {
    const now = toDatetimeLocalValue();
    return `${bookStockDate}T${now.slice(11)}`;
  }
  return toDatetimeLocalValue();
}

function datetimeLocalToParts(value: string): {
  bookStockDate: string;
  importedAt: string;
} {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Select a valid book-stock date and time");
  }
  return {
    bookStockDate: value.slice(0, 10),
    importedAt: parsed.toISOString(),
  };
}

function mergeImportResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    totalRows: a.totalRows + b.totalRows,
    matchedRows: a.matchedRows + b.matchedRows,
    unmatchedRows: a.unmatchedRows + b.unmatchedRows,
    invalidRows: a.invalidRows + b.invalidRows,
    duplicateRows: a.duplicateRows ?? 0,
    errors: [...a.errors, ...b.errors].slice(0, 50),
  };
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}

type Store = { id: number; name: string; code: string; erpType: string };

export function BookStockImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<BookStockPreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [bookStockAtLocal, setBookStockAtLocal] = useState(() =>
    toDatetimeLocalValue(),
  );
  const [excelBookStockAt, setExcelBookStockAt] = useState("");
  const [imports, setImports] = useState<BookStockUploadSummary[]>([]);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    importedAt: string;
    bookStockDate: string;
  } | null>(null);
  const [progress, setProgress] = useState<BookStockImportProgress | null>(null);

  const selectedStore = useMemo(
    () => stores.find((store) => String(store.id) === storeId) ?? null,
    [stores, storeId],
  );
  const erpType: ErpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
  const erpHelp = BOOK_STOCK_COLUMNS[erpType];

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const mismatch = await checkUploadErpMismatch(
      selected,
      resolveStoreErpType(selectedStore?.erpType),
      detectBookStockFileErpType,
    );
    if (mismatch) {
      setError(mismatch);
      reportErpMismatch(mismatch);
      return false;
    }
    return true;
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setPreview(null);
    setResult(null);
    setExcelBookStockAt("");
    if (!selected) {
      setFile(null);
      return;
    }
    if (!storeId) {
      setFile(selected);
      return;
    }
    const valid = await validateSelectedFile(selected);
    if (!valid) {
      event.target.value = "";
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
  }

  useEffect(() => {
    if (!storeId) {
      setImports([]);
      return;
    }
    void listBookStockImports(Number(storeId)).then((response) => {
      if (response.success) setImports(response.data);
    });
  }, [storeId, listRefreshKey]);

  async function confirmDeleteUpload() {
    const pending = pendingDelete;
    if (!pending || !storeId) return;
    setDeletingUpload(pending.importedAt);
    setError(null);
    const response = await deleteBookStockUpload(
      Number(storeId),
      pending.importedAt,
    );
    setDeletingUpload(null);
    setPendingDelete(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setListRefreshKey((key) => key + 1);
  }

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      if (!storeId) {
        setError("Select a store before previewing the file.");
        return;
      }
      const selected = formData.get("file") as File;
      if (!(selected instanceof File) || selected.size === 0) {
        setError("Choose an Excel file to preview.");
        return;
      }
      if (!(await validateSelectedFile(selected))) {
        return;
      }
      setFile(selected);
      formData.set("storeId", storeId);
      const data = await parseBookStockFile(formData);
      setPreview(data);
      const fromFile = datetimeLocalFromFile(selected.name, data.bookStockDate);
      setBookStockAtLocal(fromFile);
      setExcelBookStockAt(fromFile);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setError(message);
      reportErpMismatch(message);
    }
  }

  async function onImport() {
    if (!file || !storeId) {
      setError("Select a store and file first");
      return;
    }

    let bookStockDate: string;
    let uploadImportedAt: string;
    try {
      const parts = datetimeLocalToParts(bookStockAtLocal);
      bookStockDate = parts.bookStockDate;
      uploadImportedAt = parts.importedAt;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Select a book-stock date and time");
      return;
    }

    if (!(await validateSelectedFile(file))) {
      return;
    }

    const store = stores.find((s) => String(s.id) === storeId);
    const storeName = store?.name ?? "";
    setError(null);
    setResult(null);

    try {
      const parsed = await parseBookStockFileBuffer(
        await file.arrayBuffer(),
        file.name,
      );
      const columns = resolveBookStockColumns(parsed, erpType);
      if (!columns.refCol || !columns.qtyCol) {
        setError(
          erpType === "glopos"
            ? "File must include ID and QTY columns (or Stock Valuation Item Code + Current Stock)"
            : "File must include Item Code and Current Stock columns",
        );
        return;
      }

      const prepared = prepareBookStockImport({
        parsed,
        referenceColumn: columns.refCol,
        quantityColumn: columns.qtyCol,
        bookStockDate,
      });

      if (!prepared.slimRows.length) {
        setError(
          parsed.gloposStockValuation || /stock\s*valuation/i.test(file.name)
            ? "No Item Code / Current Stock rows found in this Stock Valuation file."
            : "No book stock rows found. For GloPOS use a file with ID and QTY columns (or Stock Valuation with Item Code + Current Stock).",
        );
        return;
      }

      const stockDate = prepared.stockDate || bookStockDate;
      const slimRows = prepared.slimRows;
      const batches = chunkRows(slimRows, BOOK_STOCK_IMPORT_CHUNK_SIZE);
      const totalRows = slimRows.length;

      setProgress({
        processed: 0,
        total: totalRows,
        fileName: file.name,
        storeName,
        done: false,
      });

      let importedAt: string | undefined = uploadImportedAt;
      let aggregated: ImportResult = {
        totalRows: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        invalidRows: 0,
        duplicateRows: prepared.duplicateRows,
        errors: [],
      };
      let processed = 0;

      for (const batch of batches) {
        const chunk = await importBookStockChunk({
          storeId: Number(storeId),
          bookStockDate: stockDate,
          referenceColumn: prepared.refCol,
          quantityColumn: prepared.qtyCol,
          fileName: file.name,
          importedAt,
          rows: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          reportErpMismatch(chunk.error);
          setProgress(null);
          return;
        }
        importedAt = chunk.data.importedAt;
        aggregated = mergeImportResults(aggregated, chunk.data);
        processed += batch.length;
        setProgress({
          processed,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: processed >= totalRows,
        });
      }

      const finalResult = { ...aggregated, duplicateRows: prepared.duplicateRows };
      setResult(finalResult);
      setPreview(null);
      setProgress(null);
      setListRefreshKey((key) => key + 1);

      if (finalResult.matchedRows === 0 && finalResult.totalRows > 0) {
        setError(
          "Import finished but no products matched this store’s catalog — nothing was saved to book stock. Item codes in the file must match store product codes on the Products page.",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      setError(message);
      reportErpMismatch(message);
      setProgress(null);
    }
  }

  const progressPercent = progress
    ? Math.round((progress.processed / Math.max(1, progress.total)) * 100)
    : 0;

  const previewRef =
    preview?.referenceColumn ??
    (erpType === "glopos" ? "ID" : "Item Code");
  const previewQty =
    preview?.quantityColumn ??
    (erpType === "glopos" ? "QTY" : "Current Stock");

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Columns are detected automatically. {erpHelp.label}.
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <form
          action={onPreview}
          className="grid gap-4 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm"
        >
          <div>
            <Label>Store</Label>
            <Select
              name="storeId"
              required
              value={storeId}
              onChange={async (e) => {
                const nextStoreId = e.target.value;
                setStoreId(nextStoreId);
                setPreview(null);
                if (file && nextStoreId) {
                  const nextStore = stores.find(
                    (store) => String(store.id) === nextStoreId,
                  );
                  const mismatch = await checkUploadErpMismatch(
                    file,
                    resolveStoreErpType(nextStore?.erpType),
                    detectBookStockFileErpType,
                  );
                  if (mismatch) {
                    setError(mismatch);
                    reportErpMismatch(mismatch);
                    setFile(null);
                  }
                }
              }}
            >
              <option value="" disabled>
                Select store
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name} ({store.code}) —{" "}
                  {store.erpType === "glopos" ? "GloPOS" : "MSP"}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>BK file (CSV or XLSX)</Label>
            <FileUploadField
              name="file"
              accept=".csv,.xlsx,.xls"
              required
              onChange={onFileChange}
            />
          </div>
          <div>
            <Button type="submit">Preview file</Button>
          </div>
        </form>

        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm lg:min-h-48">
          {progress ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Import progress</h3>
              <p className="font-medium text-zinc-900">
                {progress.done
                  ? "Book stock import complete"
                  : "Saving book stock…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.storeName}
              </p>
              <div
                className="h-3 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
                aria-label="Book stock import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    progress.done ? "bg-emerald-500" : "bg-emerald-600"
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-sm text-zinc-600">
                Saved {progress.processed.toLocaleString()} of{" "}
                {progress.total.toLocaleString()} products · {progressPercent}%
              </p>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Last import result</h3>
              <ImportSummary result={result} />
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-zinc-900">Ready to import</h3>
              {preview.duplicateRows ? (
                <p className="text-sm text-emerald-800">
                  Grouped {preview.duplicateRows.toLocaleString()} duplicate row(s)
                  (quantities summed) before import.
                </p>
              ) : null}
              {preview.totalProducts ? (
                <p className="text-sm text-zinc-600">
                  {preview.totalProducts.toLocaleString()} products · using{" "}
                  <strong>{previewRef}</strong> + <strong>{previewQty}</strong>
                </p>
              ) : null}
              <div className="max-w-sm">
                <Label>Book-stock date & time</Label>
                {excelBookStockAt ? (
                  <p className="mb-1.5 text-xs text-zinc-500">
                    Prefilled from the file (
                    {new Date(excelBookStockAt).toLocaleString()}). Change below if
                    needed.
                  </p>
                ) : null}
                <Input
                  type="datetime-local"
                  value={bookStockAtLocal}
                  onChange={(e) => setBookStockAtLocal(e.target.value)}
                  required
                />
                {excelBookStockAt && bookStockAtLocal !== excelBookStockAt ? (
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    onClick={() => setBookStockAtLocal(excelBookStockAt)}
                  >
                    Reset to file date & time
                  </button>
                ) : null}
              </div>
              <Button type="button" onClick={() => void onImport()}>
                Import book stock
              </Button>
            </div>
          ) : (
            <div className="flex h-full min-h-40 flex-col justify-center text-sm text-zinc-500">
              <p className="font-medium text-zinc-700">Import result</p>
              <p className="mt-1">
                Preview a file, then import to see matched, unmatched, and error
                counts here.
              </p>
            </div>
          )}
        </div>
      </div>

      {storeId ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Saved book stock uploads</h3>
          <p className="text-sm text-zinc-600">
            Ordering uses the latest upload unless you pick an older one.
          </p>
          {imports.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Uploaded at</th>
                    <th className="px-3 py-2">Book-stock date</th>
                    <th className="px-3 py-2">Products</th>
                    <th className="px-3 py-2">Total qty</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((entry, index) => (
                    <tr key={entry.importedAt} className="border-t">
                      <td className="px-3 py-2 font-medium">
                        {new Date(entry.importedAt).toLocaleString()}
                        {index === 0 ? (
                          <span className="ml-2 text-xs font-semibold text-emerald-700">
                            Latest
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{entry.bookStockDate}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {entry.itemCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDecimal(parseDbDecimal(entry.totalBookStockQty), 2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={deletingUpload === entry.importedAt}
                          onClick={() =>
                            setPendingDelete({
                              importedAt: entry.importedAt,
                              bookStockDate: entry.bookStockDate,
                            })
                          }
                        >
                          {deletingUpload === entry.importedAt
                            ? "Deleting…"
                            : "Delete"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              No book stock saved for this store yet. Import a file to add data.
            </p>
          )}
        </section>
      ) : null}

      <ConfirmAlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingUpload) setPendingDelete(null);
        }}
        title="Delete book stock upload?"
        description={
          pendingDelete
            ? `Delete book stock upload for ${selectedStore?.name ?? "this store"} on ${pendingDelete.bookStockDate} (imported ${new Date(pendingDelete.importedAt).toLocaleString()})?`
            : ""
        }
        confirming={Boolean(
          pendingDelete && deletingUpload === pendingDelete.importedAt,
        )}
        onConfirm={() => void confirmDeleteUpload()}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
