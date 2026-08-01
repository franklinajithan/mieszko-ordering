"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { beginDailySalesImport, deleteDailySalesUpload, listDailySalesSummaries, previewDailySalesUpload, runDailySalesImportBatch } from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectSalesColumns } from "@/parsers/file-parser";
import type { ImportResult } from "@/types";
import { detectDailySalesFileErpType, reportErpMismatch, resolveStoreErpType } from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { Store, PreviewState, ImportProgress, DailySalesUploadRow } from "@/types/daily-sales";

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
  const [uploadRows, setUploadRows] = useState<DailySalesUploadRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  function uploadRowKey(forStoreId: string, forSalesDate: string) {
    return `${forStoreId}|${forSalesDate}`;
  }

  async function loadUploadRows(forStoreId: string) {
    if (!forStoreId) {
      setUploadRows([]);
      return;
    }
    setLoadingRows(true);
    const response = await listDailySalesSummaries(Number(forStoreId));
    setLoadingRows(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const store = stores.find((s) => String(s.id) === forStoreId);
    setUploadRows(
      response.data.map((row) => ({
        id: uploadRowKey(forStoreId, row.salesDate),
        storeId: forStoreId,
        storeName: store?.name ?? "",
        salesDate: row.salesDate,
        matchedRows: row.itemCount,
        totalSoldQty: row.totalSoldQty,
        uploadedAt: new Date(row.lastUpdated),
      })),
    );
  }

  useEffect(() => {
    void loadUploadRows(storeId);
  }, [storeId, stores]);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const selectedStore = stores.find((store) => String(store.id) === storeId);
    const mismatch = await checkUploadErpMismatch(selected, resolveStoreErpType(selectedStore?.erpType), detectDailySalesFileErpType);
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
        const message = "Select a store before previewing the file.";
        setError(message);
        return;
      }
      const selected = formData.get("file") as File;
      if (!(await validateSelectedFile(selected))) {
        return;
      }
      setFile(selected);
      formData.set("storeId", storeId);
      const data = await previewDailySalesUpload(formData);
      setPreview(data);
      const detected = detectSalesColumns(data.headers);
      setProductColumn(data.productColumn ?? detected.productColumn ?? data.headers[0] ?? "");
      setQuantityColumn(data.quantityColumn ?? detected.quantityColumn ?? data.headers[1] ?? "");
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
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("storeId", storeId);
    formData.set("mappingType", "store_product_code");
    formData.set("productColumn", productColumn);
    formData.set("quantityColumn", quantityColumn);
    if (salesDate) formData.set("manualSalesDate", salesDate);

    setResult(null);
    const begin = await beginDailySalesImport(formData);
    if (!begin.success) {
      setError(begin.error);
      reportErpMismatch(begin.error);
      return;
    }

    const { jobId, totalRows, batchSize, fileName, storeName } = begin.data;
    setProgress({
      processed: 0,
      total: totalRows,
      fileName,
      storeName,
      done: false,
    });

    let finalResult: ImportResult | null = null;
    const batchCount = Math.ceil(totalRows / batchSize);
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = await runDailySalesImportBatch({ jobId, batchIndex });
      if (!batch.success) {
        setError(batch.error);
        reportErpMismatch(batch.error);
        return;
      }

      finalResult = batch.data.result;
      setProgress({
        processed: batch.data.processed,
        total: batch.data.total,
        fileName,
        storeName,
        done: batch.data.done,
      });
    }

    if (finalResult) {
      setResult(finalResult);
      setPreview(null);
      setProgress(null);
      await loadUploadRows(storeId);
    }
  }

  async function onDeleteRow(row: DailySalesUploadRow) {
    if (!window.confirm(`Delete all saved daily sales for ${row.storeName} on ${row.salesDate}?`)) {
      return;
    }

    setDeletingId(row.id);
    setError(null);
    const response = await deleteDailySalesUpload(Number(row.storeId), row.salesDate);
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadUploadRows(row.storeId);
  }

  const progressPercent = progress ? Math.round((progress.processed / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Product and quantity columns are detected automatically. GloPOS Stock Reports use
        <strong> ID</strong> + <strong>Sold QTY</strong>; MSP sales files use
        <strong> ItemCode</strong> + <strong>SoldQty</strong>.
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <form action={onPreview} className="grid gap-4 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm">
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
                {progress.done ? "Daily sales import complete" : "Saving daily sales…"}
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
                    Prefilled from the Excel report ({excelSalesDate}). Change below
                    if you need a different sales date.
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

      <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-zinc-900">Saved daily sales</h3>
        {!storeId ? (
          <p className="text-sm text-zinc-600">Select a store to see sales dates already in the database.</p>
        ) : loadingRows ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : uploadRows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-3 py-2">Sales date</th>
                  <th className="px-3 py-2">Products saved</th>
                  <th className="px-3 py-2">Sold qty</th>
                  <th className="px-3 py-2">Last updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploadRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.salesDate}</td>
                    <td className="px-3 py-2 tabular-nums">{row.matchedRows.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDecimal(parseDbDecimal(row.totalSoldQty), 2)}</td>
                    <td className="px-3 py-2">{row.uploadedAt.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <Button type="button" variant="outline" size="sm" disabled={deletingId === row.id} onClick={() => onDeleteRow(row)}>
                        {deletingId === row.id ? "Deleting…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-600">No daily sales saved for this store yet. Import a file to add data.</p>
        )}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
