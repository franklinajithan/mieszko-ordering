"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  BOOK_STOCK_BULK_MAX_ROWS,
  BOOK_STOCK_IMPORT_CHUNK_SIZE,
  importBookStockBulk,
  importBookStockChunk,
  listBookStockImports,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectBookStockColumns } from "@/parsers/file-parser";
import { parseBookStockFileOnClient } from "@/lib/book-stock/parse-on-client";
import type { BookStockFileParseResult } from "@/parsers/book-stock-file-parser";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { BOOK_STOCK_COLUMNS, type ErpType, type FilePreview, type ImportResult } from "@/types";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

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
  storeErpType: ErpType,
): PreparedBookStockImport {
  const shouldPivot = parsed.gloposStockValuation || storeErpType === "glopos";
  let rows = parsed.rows;
  let duplicateRows = parsed.duplicateRows ?? 0;
  if (shouldPivot && !parsed.gloposStockValuation) {
    const pivoted = pivotBookStockByReference(rows, refCol, qtyCol);
    rows = pivoted.rows;
    duplicateRows += pivoted.duplicateRows;
  }

  const slimRows = rows.map((row) => ({
    [refCol]: row[refCol] ?? "",
    [qtyCol]: row[qtyCol] ?? "",
    __rowNumber: row.__rowNumber ?? "",
  }));

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


function mergeImportResults(
  a: ImportResult & { importId?: number },
  b: ImportResult & { importId: number },
): ImportResult & { importId: number } {
  return {
    totalRows: a.totalRows + b.totalRows,
    matchedRows: a.matchedRows + b.matchedRows,
    unmatchedRows: a.unmatchedRows + b.unmatchedRows,
    invalidRows: a.invalidRows + b.invalidRows,
    duplicateRows: a.duplicateRows ?? 0,
    errors: [...a.errors, ...b.errors].slice(0, 50),
    importId: b.importId,
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
type BookStockImport = {
  importId: number;
  fileName: string | null;
  bookStockDate: string;
  importedAt: Date;
  itemCount: number;
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
  const [result, setResult] = useState<(ImportResult & { importId?: number }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [imports, setImports] = useState<BookStockImport[]>([]);
  const [bookStockDate, setBookStockDate] = useState(
    new Date().toISOString().slice(0, 10),
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
  }, [storeId, result]);

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

      const detected = detectBookStockColumns(parsed.headers, erpType);
      const refCol =
        parsed.referenceColumn ?? detected.referenceColumn ?? parsed.headers[0] ?? "";
      const qtyCol =
        parsed.quantityColumn ?? detected.quantityColumn ?? parsed.headers[1] ?? "";

      setPreview({
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 10),
        referenceColumn: refCol,
        quantityColumn: qtyCol,
        bookStockDate: parsed.bookStockDate,
        duplicateRows: parsed.duplicateRows,
        totalProducts: parsed.rows.length,
      });
      setReferenceColumn(refCol);
      setQuantityColumn(qtyCol);
      if (parsed.bookStockDate) setBookStockDate(parsed.bookStockDate);

      importCacheRef.current = {
        fileKey: fileImportKey(file),
        prepared: prepareSlimRows(parsed, refCol, qtyCol, erpType),
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
      setError("Select product code and quantity columns");
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
        const refCol = parsed.referenceColumn ?? referenceColumn;
        const qtyCol = parsed.quantityColumn ?? quantityColumn;
        prepared = prepareSlimRows(
          parsed,
          refCol,
          qtyCol,
          resolveStoreErpType(store?.erpType),
        );
        if (parsed.bookStockDate) setBookStockDate(parsed.bookStockDate);
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
        setError("No book stock rows found in the file.");
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
        if (bulkResult.matchedRows === 0 && bulkResult.totalRows > 0) {
          setError(
            "Import finished but no products matched this store’s catalog — nothing was saved to book stock. Item codes in the file must match store product codes on the Products page.",
          );
        }
        return;
      }

      const batches = chunkRows(slimRows, BOOK_STOCK_IMPORT_CHUNK_SIZE);
      let importId: number | undefined;
      let aggregated: ImportResult & { importId?: number } = {
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
          importId,
          rows: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          reportErpMismatch(chunk.error);
          setProgress(null);
          setImporting(false);
          return;
        }
        importId = chunk.data.importId;
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
      const finalResult = { ...aggregated, importId, duplicateRows };
      setResult(finalResult);
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
        Book stock format depends on the store ERP.{" "}
        <strong>{erpHelp.label}</strong>
        {erpType === "glopos" ? (
          <>
            {" "}
            — duplicate <strong>Item Code</strong> rows are summed automatically before
            import.
          </>
        ) : (
          <>
            {" "}
            GloPOS <strong>Stock Valuation (Detail)</strong> exports are also supported
            (Item Code + Current Stock, pivoted by item).
          </>
        )}
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

      {imports.length ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Import history (newest first)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-3 py-2">Imported at</th>
                  <th className="px-3 py-2">Book-stock date</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Products</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((entry) => (
                  <tr key={entry.importId} className="border-t">
                    <td className="px-3 py-2">
                      {new Date(entry.importedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{entry.bookStockDate}</td>
                    <td className="px-3 py-2">{entry.fileName ?? "—"}</td>
                    <td className="px-3 py-2">{entry.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Column mapping</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Product code column</Label>
              <Select
                value={referenceColumn}
                onChange={(e) => setReferenceColumn(e.target.value)}
              >
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Quantity column</Label>
              <Select
                value={quantityColumn}
                onChange={(e) => setQuantityColumn(e.target.value)}
              >
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {(erpType === "glopos" || preview.duplicateRows || preview.totalProducts) ? (
            <p className="text-sm text-amber-800">
              {preview.totalProducts
                ? `${preview.totalProducts.toLocaleString()} products ready to import after pivot. `
                : ""}
              {preview.duplicateRows
                ? `${preview.duplicateRows.toLocaleString()} duplicate item row(s) were combined when summing Current Stock.`
                : erpType === "glopos"
                  ? "GloPOS detail files often have multiple rows per item. On import, quantities will be summed by product code."
                  : null}
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  {preview.headers.map((header) => (
                    <th key={header} className="px-2 py-1 text-left">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, idx) => (
                  <tr key={idx}>
                    {preview.headers.map((header) => (
                      <td key={header} className="px-2 py-1">
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
