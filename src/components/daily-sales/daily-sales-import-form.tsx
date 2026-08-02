"use client";

import { useState, type ChangeEvent } from "react";
import { importDailySalesChunk, parseDailySalesFile } from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DailySalesListPage } from "@/components/daily-sales/daily-sales-list-page";
import {
  detectSalesColumns,
  parseDailySalesFileBuffer,
} from "@/parsers/daily-sales-file-parser";
import { prepareDailySalesImport } from "@/services/daily-sales-import-prepare";
import type { ImportResult } from "@/types";
import {
  detectDailySalesFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import { decimalToDb } from "@/utils/decimal";
import type { Store, PreviewState, ImportProgress } from "@/types/daily-sales";

const DAILY_SALES_IMPORT_CHUNK_SIZE = parseInt(
  process.env.NEXT_PUBLIC_DAILY_SALES_IMPORT_CHUNK_SIZE ?? "2000",
);

function mergeMatchResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    ...a,
    matchedRows: a.matchedRows + b.matchedRows,
    unmatchedRows: a.unmatchedRows + b.unmatchedRows,
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

export function DailySalesImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [productColumn, setProductColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [salesDate, setSalesDate] = useState("");
  const [excelSalesDate, setExcelSalesDate] = useState("");
  const [storeId, setStoreId] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const selectedStore = stores.find((store) => String(store.id) === storeId);
    const mismatch = await checkUploadErpMismatch(
      selected,
      resolveStoreErpType(selectedStore?.erpType),
      detectDailySalesFileErpType,
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
    setExcelSalesDate("");
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
      if (!(await validateSelectedFile(selected))) {
        return;
      }
      setFile(selected);
      formData.set("storeId", storeId);
      const data = await parseDailySalesFile(formData);
      setPreview(data);
      const detected = detectSalesColumns(data.headers);
      setProductColumn(
        data.productColumn ?? detected.productColumn ?? data.headers[0] ?? "",
      );
      setQuantityColumn(
        data.quantityColumn ?? detected.quantityColumn ?? data.headers[1] ?? "",
      );
      if (data.manualSalesDate) {
        setExcelSalesDate(data.manualSalesDate);
        setSalesDate(data.manualSalesDate);
      } else {
        setExcelSalesDate("");
      }
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
    if (!salesDate) {
      setError("Select a sales date");
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
      const parsed = await parseDailySalesFileBuffer(
        await file.arrayBuffer(),
        file.name,
      );
      const codeColumn =
        productColumn ||
        parsed.productColumn ||
        detectSalesColumns(parsed.headers).productColumn ||
        "";
      const qtyColumn =
        quantityColumn ||
        parsed.quantityColumn ||
        detectSalesColumns(parsed.headers).quantityColumn ||
        "";
      if (!codeColumn || !qtyColumn) {
        setError("Could not detect product and quantity columns.");
        return;
      }

      const { sales, result: prepResult } = prepareDailySalesImport({
        productColumn: codeColumn,
        quantityColumn: qtyColumn,
        manualSalesDate: salesDate,
        rows: parsed.rows,
      });

      if (!sales.length) {
        setError(
          prepResult.invalidRows
            ? "No valid daily-sales rows found in the file."
            : "No daily-sales rows found in the file.",
        );
        setResult(prepResult);
        return;
      }

      const slimRows = sales.map((sale) => ({
        [codeColumn]: sale.reference,
        [qtyColumn]: decimalToDb(sale.qty),
        __productName: sale.productName ?? "",
        __rowNumber: String(sale.rowNumber),
      }));

      const batches = chunkRows(slimRows, DAILY_SALES_IMPORT_CHUNK_SIZE);
      const totalRows = slimRows.length;
      setProgress({
        processed: 0,
        total: totalRows,
        fileName: file.name,
        storeName,
        done: false,
      });

      let aggregated: ImportResult = {
        ...prepResult,
        matchedRows: 0,
        unmatchedRows: 0,
      };
      let processed = 0;

      for (const batch of batches) {
        const chunk = await importDailySalesChunk({
          storeId: Number(storeId),
          mappingType: "store_product_code",
          productColumn: codeColumn,
          quantityColumn: qtyColumn,
          manualSalesDate: salesDate,
          fileName: file.name,
          rows: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          reportErpMismatch(chunk.error);
          setProgress(null);
          return;
        }
        aggregated = mergeMatchResults(aggregated, chunk.data);
        processed += batch.length;
        setProgress({
          processed,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: processed >= totalRows,
        });
      }

      setResult(aggregated);
      setPreview(null);
      setProgress(null);
      setListRefreshKey((key) => key + 1);
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Product and quantity columns are detected automatically. GloPOS Stock
        Reports use <strong> ID</strong> + <strong>Sold QTY</strong>; MSP sales
        files use <strong> ItemCode</strong> + <strong>SoldQty</strong>.
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
                    detectDailySalesFileErpType,
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
                  {store.name} ({store.erpType === "glopos" ? "GloPOS" : "MSP"})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>CSV or XLSX file</Label>
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
                  ? "Daily sales import complete"
                  : "Saving daily sales…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.storeName}
              </p>
              <div
                className="h-3 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
                aria-label="Daily sales import progress"
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
                {progress.total.toLocaleString()} sales rows · {progressPercent}%
              </p>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Last import result</h3>
              <ImportSummary result={result} />
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-zinc-900">Column mapping</h3>
              {preview.periodLabel ? (
                <p className="text-sm text-amber-800">
                  Period file detected ({preview.periodLabel}). Quantities will be
                  stored on the period end date for historical comparisons.
                </p>
              ) : null}
              {preview.duplicateRows ? (
                <p className="text-sm text-emerald-800">
                  Grouped {preview.duplicateRows} duplicate Item Code rows
                  (quantities summed) before import.
                </p>
              ) : null}
              <div className="max-w-sm">
                <Label>Sales date</Label>
                {excelSalesDate ? (
                  <p className="mb-1.5 text-xs text-zinc-500">
                    Prefilled from the Excel report ({excelSalesDate}). Change
                    below if you need a different sales date.
                  </p>
                ) : null}
                <DateField
                  value={salesDate}
                  onChange={(e) => setSalesDate(e.target.value)}
                  required
                />
                {excelSalesDate && salesDate !== excelSalesDate ? (
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    onClick={() => setSalesDate(excelSalesDate)}
                  >
                    Reset to Excel date
                  </button>
                ) : null}
              </div>
              <Button type="button" onClick={onImport}>
                Import daily sales
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

      <DailySalesListPage
        storeId={storeId}
        stores={stores}
        refreshKey={listRefreshKey}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
