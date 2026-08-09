"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  BOOK_STOCK_BULK_MAX_ROWS,
  BOOK_STOCK_IMPORT_CHUNK_SIZE,
  deleteBookStockUpload,
  importBookStockBulk,
  importBookStockChunk,
  listBookStockImports,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseBookStockFileOnClient } from "@/lib/book-stock/parse-on-client";
import type { BookStockFileParseResult } from "@/parsers/book-stock-file-parser";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { BOOK_STOCK_COLUMNS } from "@/lib/import-config";
import type { ErpType, FilePreview, ImportResult } from "@/types";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

const GLOPOS_ID_COLUMN = "ID";
const GLOPOS_QTY_COLUMN = "QTY";
const STOCK_VALUATION_ITEM_CODE_COLUMN = "Item Code";
const STOCK_VALUATION_CURRENT_STOCK_COLUMN = "Current Stock";

function toDatetimeLocalValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalToIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Select a valid upload date and time");
  }
  return parsed.toISOString();
}

function resolveBookStockColumns(
  parsed: BookStockFileParseResult,
  erpType: ErpType,
): { refCol: string; qtyCol: string } {
  if (parsed.referenceColumn && parsed.quantityColumn) {
    return { refCol: parsed.referenceColumn, qtyCol: parsed.quantityColumn };
  }
  if (parsed.gloposStockValuation || erpType === "msp") {
    return {
      refCol: STOCK_VALUATION_ITEM_CODE_COLUMN,
      qtyCol: STOCK_VALUATION_CURRENT_STOCK_COLUMN,
    };
  }
  return { refCol: GLOPOS_ID_COLUMN, qtyCol: GLOPOS_QTY_COLUMN };
}

type BookStockJobProgress = {
  job: "preview" | "import";
  phase: "workbook" | "rows" | "saving";
  processed: number;
  total: number;
  fileName: string;
  storeName: string;
  done: boolean;
  savingBatch?: number;
  savingBatchTotal?: number;
};

function jobProgressPercent(progress: BookStockJobProgress): number {
  if (progress.done) return 100;
  if (progress.phase === "workbook") {
    if (progress.total <= 0) return 1;
    return Math.min(15, Math.floor((progress.processed / progress.total) * 15));
  }
  if (progress.phase === "rows") {
    if (progress.total <= 0) return 15;
    return Math.min(
      99,
      15 + Math.floor((progress.processed / progress.total) * 84),
    );
  }
  if (progress.phase === "saving") {
    if (progress.total <= 0) return progress.done ? 100 : 1;
    if (progress.done) return 100;
    const fromProducts = Math.floor((progress.processed / progress.total) * 100);
    if (fromProducts > 0) return Math.min(99, fromProducts);
    if (
      progress.savingBatch &&
      progress.savingBatchTotal &&
      progress.savingBatchTotal > 1
    ) {
      const completed = Math.max(0, progress.savingBatch - 1);
      return Math.min(
        98,
        Math.floor((completed / progress.savingBatchTotal) * 100) + 2,
      );
    }
    return 8;
  }
  return 0;
}

function jobProgressTitle(progress: BookStockJobProgress): string {
  if (progress.done) {
    return progress.job === "preview" ? "Preview ready" : "Book stock import complete";
  }
  if (progress.job === "preview") {
    if (progress.phase === "workbook") return "Loading workbook…";
    return "Reading rows and pivoting stock…";
  }
  if (progress.phase === "workbook" || progress.phase === "rows") {
    return "Reading and preparing file…";
  }
  if (!progress.done && progress.processed === 0) {
    return "Uploading book stock to the server…";
  }
  return "Saving book stock to database…";
}

function jobProgressDetail(progress: BookStockJobProgress, percent: number): string {
  if (progress.phase === "workbook") {
    return `Loading spreadsheet · ${percent}%`;
  }
  if (progress.phase === "rows") {
    return `Processed ${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()} spreadsheet rows · ${percent}%`;
  }
  if (!progress.done && progress.processed === 0) {
    if (progress.savingBatchTotal === 1) {
      return `Uploading ${progress.total.toLocaleString()} products to the server… · ${percent}%`;
    }
    return `Uploading batch ${progress.savingBatch ?? 1} of ${progress.savingBatchTotal ?? 1}… · ${percent}%`;
  }
  return `Saved ${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()} products${
    progress.savingBatch && progress.savingBatchTotal
      ? progress.savingBatchTotal === 1
        ? " · single fast upload"
        : ` · batch ${progress.savingBatch} of ${progress.savingBatchTotal}`
      : ""
  } · ${percent}%`;
}

function fileImportKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

type PreparedBookStockImport = {
  refCol: string;
  qtyCol: string;
  stockDate: string;
  duplicateRows: number;
  slimRows: Array<Record<string, string>>;
};

function prepareSlimRows(
  parsed: BookStockFileParseResult,
  refCol: string,
  qtyCol: string,
  _storeErpType: ErpType,
): PreparedBookStockImport {
  // Dedicated parsers already sum qty by product code.
  let rows = parsed.rows;
  let duplicateRows = parsed.duplicateRows ?? 0;
  if (!parsed.preAggregated && !parsed.gloposStockValuation) {
    const pivoted = pivotBookStockByReference(rows, refCol, qtyCol);
    rows = pivoted.rows;
    duplicateRows += pivoted.duplicateRows;
  }

  const slimRows = rows
    .map((row) => ({
      [refCol]: String(row[refCol] ?? "").trim(),
      [qtyCol]: String(row[qtyCol] ?? "").trim(),
      __rowNumber: String(row.__rowNumber ?? ""),
    }))
    .filter((row) => row[refCol] && row[qtyCol] !== "");

  return {
    refCol,
    qtyCol,
    stockDate: parsed.bookStockDate ?? "",
    duplicateRows,
    slimRows,
  };
}

function BookStockProgressPanel({
  progress,
  percent,
}: {
  progress: BookStockJobProgress;
  percent: number;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <h4 className="font-semibold text-zinc-900">
        {progress.job === "preview" ? "Preview progress" : "Import progress"}
      </h4>
      <p className="font-medium text-zinc-900">{jobProgressTitle(progress)}</p>
      <p className="text-sm text-zinc-600">
        {progress.fileName} · {progress.storeName}
      </p>
      <div
        className="h-3 overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-label={
          progress.job === "preview" ? "Preview progress" : "Book stock import progress"
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            progress.done ? "bg-emerald-500" : "bg-emerald-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-zinc-600">{jobProgressDetail(progress, percent)}</p>
    </div>
  );
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

function mapParseProgress(
  job: "preview" | "import",
  fileName: string,
  storeName: string,
  p: { phase: "workbook" | "rows"; processed: number; total: number },
  done = false,
): BookStockJobProgress {
  return {
    job,
    phase: p.phase,
    processed: p.processed,
    total: p.total,
    fileName,
    storeName,
    done,
  };
}

type Store = { id: number; name: string; code: string; erpType: string };
type BookStockUploadSummary = {
  bookStockDate: string;
  importedAt: string;
  itemCount: number;
  totalBookStockQty: string;
};

type BookStockPreview = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
  totalProducts?: number;
};

export function BookStockImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<BookStockPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [imports, setImports] = useState<BookStockUploadSummary[]>([]);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  const [bookStockDate, setBookStockDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [importedAtLocal, setImportedAtLocal] = useState(() =>
    toDatetimeLocalValue(),
  );
  const [progress, setProgress] = useState<BookStockJobProgress | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const mountedRef = useRef(true);
  const parseAbortRef = useRef<AbortController | null>(null);
  const importCacheRef = useRef<{
    fileKey: string;
    prepared: PreparedBookStockImport;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      parseAbortRef.current?.abort();
    };
  }, []);

  function scheduleParseProgress(
    job: "preview" | "import",
    fileName: string,
    storeName: string,
    p: { phase: "workbook" | "rows"; processed: number; total: number },
    done = false,
  ) {
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      setProgress(mapParseProgress(job, fileName, storeName, p, done));
    });
  }

  async function parseFileOnClient(
    job: "preview" | "import",
    fileBlob: File,
    storeName: string,
  ) {
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;

    return parseBookStockFileOnClient(await fileBlob.arrayBuffer(), fileBlob.name, {
      signal: controller.signal,
      onProgress: (p) => scheduleParseProgress(job, fileBlob.name, storeName, p),
    });
  }

  const selectedStore = useMemo(
    () => stores.find((store) => String(store.id) === storeId) ?? null,
    [stores, storeId],
  );
  const erpType: ErpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
  const erpHelp = BOOK_STOCK_COLUMNS[erpType];
  const storeErpType = resolveStoreErpType(selectedStore?.erpType);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const mismatch = await checkUploadErpMismatch(
      selected,
      storeErpType,
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
    importCacheRef.current = null;
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

  async function onDeleteSavedUpload(importedAt: string, bookStockDate: string) {
    const store = stores.find((s) => String(s.id) === storeId);
    if (
      !window.confirm(
        `Delete book stock upload for ${store?.name ?? "this store"} on ${bookStockDate} (imported ${new Date(importedAt).toLocaleString()})?`,
      )
    ) {
      return;
    }
    setDeletingUpload(importedAt);
    setError(null);
    const response = await deleteBookStockUpload(Number(storeId), importedAt);
    setDeletingUpload(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setListRefreshKey((key) => key + 1);
  }

  async function onPreviewClick() {
    if (!file || !storeId) {
      setError("Select a store and file before previewing.");
      return;
    }
    if (!(await validateSelectedFile(file))) {
      return;
    }

    const storeName = selectedStore?.name ?? "";
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewing(true);
    importCacheRef.current = null;

    try {
      scheduleParseProgress("preview", file.name, storeName, {
        phase: "workbook",
        processed: 0,
        total: 2,
      });

      const parsed = await parseFileOnClient("preview", file, storeName);

      scheduleParseProgress(
        "preview",
        file.name,
        storeName,
        { phase: "rows", processed: parsed.rows.length, total: parsed.rows.length },
        true,
      );

      const { refCol, qtyCol } = resolveBookStockColumns(parsed, erpType);
      const prepared = prepareSlimRows(parsed, refCol, qtyCol, erpType);

      if (!prepared.slimRows.length) {
        setError(
          parsed.gloposStockValuation || /stock\s*valuation/i.test(file.name)
            ? "No Item Code / Current Stock rows found in this Stock Valuation file."
            : "No book stock rows found. For GloPOS use a file with ID and QTY columns (or Stock Valuation with Item Code + Current Stock).",
        );
        setProgress(null);
        return;
      }

      setPreview({
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 10),
        referenceColumn: refCol,
        quantityColumn: qtyCol,
        bookStockDate: parsed.bookStockDate,
        duplicateRows: prepared.duplicateRows,
        totalProducts: prepared.slimRows.length,
      });
      setReferenceColumn(refCol);
      setQuantityColumn(qtyCol);
      if (parsed.bookStockDate) setBookStockDate(parsed.bookStockDate);
      setImportedAtLocal(toDatetimeLocalValue());

      importCacheRef.current = {
        fileKey: fileImportKey(file),
        prepared,
      };

      setProgress(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Preview failed");
      setProgress(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function onImport() {
    if (!file || !storeId) {
      setError("Select a store and file first");
      return;
    }
    if (!(await validateSelectedFile(file))) {
      return;
    }
    if (!referenceColumn || !quantityColumn) {
      setError(
        erpType === "glopos"
          ? "File must include ID and QTY columns (or Stock Valuation Item Code + Current Stock)"
          : "File must include Item Code and Current Stock columns",
      );
      return;
    }

    let uploadImportedAt: string;
    try {
      uploadImportedAt = datetimeLocalToIso(importedAtLocal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid upload date and time");
      return;
    }

    const store = stores.find((s) => String(s.id) === storeId);
    const storeName = store?.name ?? "";
    setError(null);
    setResult(null);
    setImporting(true);

    try {
      let prepared: PreparedBookStockImport | null = null;
      const cache = importCacheRef.current;
      if (cache && cache.fileKey === fileImportKey(file)) {
        prepared = cache.prepared;
      } else {
        scheduleParseProgress("import", file.name, storeName, {
          phase: "workbook",
          processed: 0,
          total: 2,
        });

        const parsed = await parseFileOnClient("import", file, storeName);
        const { refCol, qtyCol } = resolveBookStockColumns(
          parsed,
          resolveStoreErpType(store?.erpType),
        );
        prepared = prepareSlimRows(
          parsed,
          refCol,
          qtyCol,
          resolveStoreErpType(store?.erpType),
        );
        if (parsed.bookStockDate) setBookStockDate(parsed.bookStockDate);
        setReferenceColumn(refCol);
        setQuantityColumn(qtyCol);
        importCacheRef.current = {
          fileKey: fileImportKey(file),
          prepared,
        };
      }

      const refCol = prepared.refCol;
      const qtyCol = prepared.qtyCol;
      const stockDate = prepared.stockDate || bookStockDate;
      const duplicateRows = prepared.duplicateRows;
      const slimRows = prepared.slimRows;

      if (!slimRows.length) {
        setError(
          /stock\s*valuation/i.test(file.name)
            ? "No Item Code / Current Stock rows found in this Stock Valuation file."
            : "No book stock rows found. For GloPOS use a file with ID and QTY columns (or Stock Valuation with Item Code + Current Stock).",
        );
        setProgress(null);
        setImporting(false);
        return;
      }

      const totalRows = slimRows.length;
      const useBulk = totalRows <= BOOK_STOCK_BULK_MAX_ROWS;

      if (useBulk) {
        setProgress({
          job: "import",
          phase: "saving",
          processed: 0,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: false,
          savingBatch: 1,
          savingBatchTotal: 1,
        });

        const bulk = await importBookStockBulk({
          storeId: Number(storeId),
          bookStockDate: stockDate,
          referenceColumn: refCol,
          quantityColumn: qtyCol,
          fileName: file.name,
          duplicateRows,
          importedAt: uploadImportedAt,
          rows: slimRows,
        });
        if (!bulk.success) {
          setError(bulk.error);
          reportErpMismatch(bulk.error);
          setProgress(null);
          setImporting(false);
          return;
        }

        setProgress({
          job: "import",
          phase: "saving",
          processed: totalRows,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: true,
          savingBatch: 1,
          savingBatchTotal: 1,
        });
        setProgress(null);
        setImporting(false);
        const bulkResult = { ...bulk.data, duplicateRows };
        setResult(bulkResult);
        setListRefreshKey((key) => key + 1);
        if (bulkResult.matchedRows === 0 && bulkResult.totalRows > 0) {
          setError(
            "Import finished but no products matched this store’s catalog — nothing was saved to book stock. Item codes in the file must match store product codes on the Products page.",
          );
        }
        return;
      }

      const batches = chunkRows(slimRows, BOOK_STOCK_IMPORT_CHUNK_SIZE);
      let importedAt: string | undefined = uploadImportedAt;
      let aggregated: ImportResult = {
        totalRows: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        invalidRows: 0,
        duplicateRows,
        errors: [],
      };
      let processed = 0;

      setProgress({
        job: "import",
        phase: "saving",
        processed: 0,
        total: totalRows,
        fileName: file.name,
        storeName,
        done: false,
        savingBatch: 0,
        savingBatchTotal: batches.length,
      });

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex]!;
        const batchNum = batchIndex + 1;
        setProgress({
          job: "import",
          phase: "saving",
          processed: batchIndex * BOOK_STOCK_IMPORT_CHUNK_SIZE,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: false,
          savingBatch: batchNum,
          savingBatchTotal: batches.length,
        });

        const chunk = await importBookStockChunk({
          storeId: Number(storeId),
          bookStockDate: stockDate,
          referenceColumn: refCol,
          quantityColumn: qtyCol,
          fileName: file.name,
          importedAt,
          rows: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          reportErpMismatch(chunk.error);
          setProgress(null);
          setImporting(false);
          return;
        }
        importedAt = chunk.data.importedAt;
        aggregated = mergeImportResults(aggregated, chunk.data);
        processed += batch.length;
        setProgress({
          job: "import",
          phase: "saving",
          processed,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: processed >= totalRows,
          savingBatch: batchNum,
          savingBatchTotal: batches.length,
        });
      }

      setProgress(null);
      setImporting(false);
      const finalResult = { ...aggregated, duplicateRows };
      setResult(finalResult);
      setListRefreshKey((key) => key + 1);
      if (finalResult.matchedRows === 0 && finalResult.totalRows > 0) {
        setError(
          "Import finished but no products matched this store’s catalog — nothing was saved to book stock. Item codes in the file must match store product codes on the Products page.",
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Import failed");
      reportErpMismatch(err instanceof Error ? err.message : "");
      setProgress(null);
      setImporting(false);
    }
  }

  const progressPercent = progress ? jobProgressPercent(progress) : 0;
  const busy = previewing || importing;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        {erpType === "glopos" ? (
          <>
            Upload GloPOS book stock with <strong>ID</strong> + <strong>QTY</strong>, or a{" "}
            <strong>Stock Valuation (Detail)</strong> file (
            <strong>Item Code</strong> + <strong>Current Stock</strong>). Duplicate codes
            are summed, then one qty per product is saved.{" "}
          </>
        ) : (
          <>
            Upload <strong>Stock Valuation (Detail)</strong> reports (
            <strong>Item Code</strong> + <strong>Current Stock</strong>). Duplicate item
            codes are summed, then one qty per product is saved.{" "}
          </>
        )}
        <span className="text-zinc-500">({erpHelp.label})</span>
      </p>

      <div className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-2">
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
                const nextStore = stores.find((store) => String(store.id) === nextStoreId);
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
          <Label>Book-stock date</Label>
          <DateField
            name="bookStockDate"
            value={bookStockDate}
            onChange={(e) => setBookStockDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Upload date & time</Label>
          <Input
            type="datetime-local"
            name="importedAt"
            value={importedAtLocal}
            onChange={(e) => setImportedAtLocal(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-zinc-500">
            Saved as this upload’s timestamp. Ordering uses the latest upload unless you
            pick an older one.
          </p>
        </div>
        <div className="md:col-span-2">
          <Label>BK file (CSV or XLSX)</Label>
          <FileUploadField
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            onChange={onFileChange}
          />
        </div>
        <div className="md:col-span-2 space-y-3">
          <Button
            type="button"
            disabled={!storeId || !file || busy}
            onClick={() => void onPreviewClick()}
          >
            {previewing ? "Previewing…" : "Preview file"}
          </Button>
          {progress && progress.job === "preview" ? (
            <BookStockProgressPanel progress={progress} percent={progressPercent} />
          ) : null}
        </div>
      </div>

      {storeId ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Saved book stock uploads</h3>
          <p className="text-sm text-zinc-600">
            Each upload keeps its timestamp. Ordering uses the latest upload unless you
            pick an older one.
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
                            void onDeleteSavedUpload(
                              entry.importedAt,
                              entry.bookStockDate,
                            )
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

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Ready to import</h3>
          <p className="text-sm text-zinc-600">
            Using <strong>{referenceColumn}</strong> and <strong>{quantityColumn}</strong>
            {preview.totalProducts
              ? ` · ${preview.totalProducts.toLocaleString()} products`
              : ""}
            {preview.duplicateRows
              ? ` · ${preview.duplicateRows.toLocaleString()} duplicate row(s) summed`
              : ""}
            .
          </p>

          <Button type="button" onClick={onImport} disabled={importing || previewing}>
            {importing ? "Importing…" : "Import book stock"}
          </Button>

          {progress && progress.job === "import" ? (
            <BookStockProgressPanel progress={progress} percent={progressPercent} />
          ) : null}
        </div>
      ) : null}

      {result && !progress ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
