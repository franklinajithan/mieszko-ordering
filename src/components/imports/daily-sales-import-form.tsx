"use client";

import { useState, type ChangeEvent } from "react";
import {
  beginDailySalesImport,
  previewDailySalesUpload,
  runDailySalesImportBatch,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectSalesColumns } from "@/parsers/file-parser";
import type { ImportResult } from "@/types";
import {
  detectDailySalesFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import type { Store, PreviewState, ImportProgress } from "@/types/daily-sales";



export function DailySalesImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [productColumn, setProductColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [salesDate, setSalesDate] = useState("");
  const [storeId, setStoreId] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);

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
      if (data.manualSalesDate) setSalesDate(data.manualSalesDate);
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

    if (finalResult) setResult(finalResult);
  }

  const progressPercent = progress
    ? Math.round((progress.processed / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Product and quantity columns are detected automatically. GloPOS Stock Reports use
        <strong> ID</strong> + <strong>Sold QTY</strong>; MSP sales files use
        <strong> ItemCode</strong> + <strong>SoldQty</strong>.
      </p>

      <form action={onPreview} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-2">
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
        <div className="md:col-span-2">
          <Button type="submit">Preview file</Button>
        </div>
      </form>

      {progress ? (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-zinc-900">
                {progress.done ? "Daily sales import complete" : "Saving daily sales…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.storeName}
              </p>
            </div>
            <span className="tabular-nums text-sm text-zinc-600">
              {progressPercent}%
            </span>
          </div>
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
            {progress.total.toLocaleString()} sales rows
          </p>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Column mapping</h3>
          {preview.periodLabel ? (
            <p className="text-sm text-amber-800">
              Period file detected ({preview.periodLabel}). Quantities will be stored on the
              period end date for historical comparisons.
            </p>
          ) : null}
          {preview.duplicateRows ? (
            <p className="text-sm text-emerald-800">
              Grouped {preview.duplicateRows} duplicate Item Code rows (quantities summed) before import.
            </p>
          ) : null}
          <div className="max-w-sm">
            <div>
              <Label>Sales date</Label>
              <DateField
                value={salesDate}
                onChange={(e) => setSalesDate(e.target.value)}
                required
              />
            </div>
          </div>

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

          <Button
            type="button"
            onClick={onImport}
            disabled={Boolean(progress && !progress.done)}
          >
            Import daily sales
          </Button>
        </div>
      ) : null}

      {result ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
