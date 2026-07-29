"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  beginRtcImport,
  deleteRtcUpload,
  listRtcSummaries,
  previewRtcUpload,
  runRtcImportBatch,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectRtcColumns } from "@/parsers/file-parser";
import type { ImportResult } from "@/types";
import {
  detectRtcFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import type { RtcImportProgress, RtcPreviewState, RtcSavedRow, Store } from "@/types/rtc";

export function RtcImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<RtcPreviewState | null>(null);
  const [result, setResult] = useState<(ImportResult & { importId?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [rtcDate, setRtcDate] = useState("");
  const [excelRtcDate, setExcelRtcDate] = useState("");
  const [mappingType, setMappingType] = useState<"store_product_code" | "barcode">(
    "store_product_code",
  );
  const [savedRows, setSavedRows] = useState<RtcSavedRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [progress, setProgress] = useState<RtcImportProgress | null>(null);

  function savedRowKey(forStoreId: string, forRtcDate: string) {
    return `${forStoreId}|${forRtcDate}`;
  }

  async function loadSavedRows(forStoreId: string) {
    if (!forStoreId) {
      setSavedRows([]);
      return;
    }
    setLoadingRows(true);
    const response = await listRtcSummaries(Number(forStoreId));
    setLoadingRows(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const store = stores.find((s) => String(s.id) === forStoreId);
    setSavedRows(
      response.data.map((row) => ({
        id: savedRowKey(forStoreId, row.rtcDate),
        storeId: forStoreId,
        storeName: store?.name ?? "",
        rtcDate: row.rtcDate,
        productCount: row.itemCount,
        totalRtcQty: row.totalRtcQty,
        lastUpdated: new Date(row.lastUpdated),
      })),
    );
  }

  useEffect(() => {
    void loadSavedRows(storeId);
  }, [storeId, stores]);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const selectedStore = stores.find((store) => String(store.id) === storeId);
    const mismatch = await checkUploadErpMismatch(
      selected,
      resolveStoreErpType(selectedStore?.erpType),
      (headers, name) => detectRtcFileErpType(headers, name),
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
    setExcelRtcDate("");
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
      const data = await previewRtcUpload(formData);
      setPreview(data);
      const selectedStore = stores.find((store) => String(store.id) === storeId);
      const erpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
      const detected = detectRtcColumns(data.headers, erpType);
      setReferenceColumn(data.referenceColumn ?? detected.referenceColumn ?? data.headers[0] ?? "");
      setQuantityColumn(data.quantityColumn ?? detected.quantityColumn ?? data.headers[1] ?? "");
      if (data.mappingType) setMappingType(data.mappingType);
      if (data.rtcDate) {
        setExcelRtcDate(data.rtcDate);
        setRtcDate(data.rtcDate);
      } else {
        setExcelRtcDate("");
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
    if (!rtcDate) {
      setError("Select an RTC date");
      return;
    }
    if (
      preview?.mappingType === "store_product_code" &&
      preview.matchedCount !== undefined &&
      preview.matchedCount === 0
    ) {
      setError(
        "No file barcodes matched this store's catalog. Fix item codes/barcodes in the catalog, then preview again.",
      );
      return;
    }
    if (!(await validateSelectedFile(file))) {
      return;
    }
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("storeId", storeId);
    formData.set("rtcDate", rtcDate);
    formData.set("mappingType", mappingType);
    formData.set("referenceColumn", referenceColumn);
    formData.set("quantityColumn", quantityColumn);

    const begin = await beginRtcImport(formData);
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
    let importId: number | undefined;
    const batchCount = Math.ceil(totalRows / batchSize);
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = await runRtcImportBatch({ jobId, batchIndex });
      if (!batch.success) {
        setError(batch.error);
        reportErpMismatch(batch.error);
        setProgress(null);
        return;
      }

      finalResult = batch.data.result;
      importId = batch.data.importId;
      setProgress({
        processed: batch.data.processed,
        total: batch.data.total,
        fileName,
        storeName,
        done: batch.data.done,
      });
    }

    setProgress(null);
    if (finalResult) {
      setResult({ ...finalResult, importId });
      setPreview(null);
      if (finalResult.matchedRows === 0 && finalResult.totalRows > 0) {
        setError(
          "Import finished but no products matched. Ensure each file barcode exists on a catalog product linked to this store (product_barcodes → store item code).",
        );
      }
      await loadSavedRows(storeId);
    }
  }

  async function onDeleteRow(row: RtcSavedRow) {
    if (!window.confirm(`Delete all saved RTC data for ${row.storeName} on ${row.rtcDate}?`)) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    const response = await deleteRtcUpload(Number(row.storeId), row.rtcDate);
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSavedRows(row.storeId);
  }

  const progressPercent = progress
    ? Math.round((progress.processed / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Upload GloPOS <strong>Price Override &amp; RTC Sales History</strong> reports (barcode +
        qty) or legacy RTC spreadsheets. Products are matched by barcode or item code for the
        selected store.
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
                  const nextStore = stores.find((store) => String(store.id) === nextStoreId);
                  const mismatch = await checkUploadErpMismatch(
                    file,
                    resolveStoreErpType(nextStore?.erpType),
                    (headers, name) => detectRtcFileErpType(headers, name),
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
            <Label>Excel file (CSV or XLSX)</Label>
            <FileUploadField
              name="file"
              accept=".csv,.xlsx,.xls"
              required
              onChange={onFileChange}
            />
          </div>
          <div>
            <Button type="submit" disabled={!storeId}>
              Preview file
            </Button>
          </div>
        </form>

        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm lg:min-h-48">
          {progress ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Import progress</h3>
              <p className="font-medium text-zinc-900">
                {progress.done ? "RTC import complete" : "Saving RTC quantities…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.storeName}
              </p>
              <div
                className="h-3 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-sm text-zinc-600">
                Saved {progress.processed.toLocaleString()} of{" "}
                {progress.total.toLocaleString()} RTC rows · {progressPercent}%
              </p>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Last import result</h3>
              <ImportSummary result={result} />
            </div>
          ) : (
            <div className="flex h-full min-h-40 flex-col justify-center text-sm text-zinc-500">
              <p className="font-medium text-zinc-700">Import result</p>
              <p className="mt-1">
                Run an import from the preview step to see matched, unmatched, and error counts
                here.
              </p>
            </div>
          )}
        </div>
      </div>

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Column mapping</h3>
          {preview.duplicateRows ? (
            <p className="text-sm text-emerald-800">
              Grouped {preview.duplicateRows} duplicate barcode rows (quantities summed) before
              import.
            </p>
          ) : null}
          {preview.mappingType === "store_product_code" &&
          preview.matchedCount !== undefined ? (
            <p
              className={
                preview.matchedCount > 0 ?
                  "text-sm text-emerald-800"
                : "text-sm text-red-700"
              }
            >
              Catalog lookup: {preview.matchedCount} barcode
              {preview.matchedCount === 1 ? "" : "s"} resolved to store item codes
              {preview.unmatchedCount ?
                ` · ${preview.unmatchedCount} unmatched`
              : ""}
              .
            </p>
          ) : null}
          {preview.unmatchedBarcodes?.length ? (
            <p className="text-xs text-zinc-600">
              Unmatched barcodes (sample): {preview.unmatchedBarcodes.join(", ")}
            </p>
          ) : null}
          <div className="max-w-sm">
            <Label>RTC date</Label>
            {excelRtcDate ? (
              <p className="mb-1.5 text-xs text-zinc-500">
                Prefilled from the Excel report ({excelRtcDate}). Change below if you need a
                different date.
              </p>
            ) : null}
            <DateField value={rtcDate} onChange={(e) => setRtcDate(e.target.value)} required />
            {excelRtcDate && rtcDate !== excelRtcDate ? (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                onClick={() => setRtcDate(excelRtcDate)}
              >
                Reset to Excel date
              </button>
            ) : null}
          </div>
          {!preview.mappingType ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Match products by</Label>
                <Select
                  value={mappingType}
                  onChange={(e) =>
                    setMappingType(e.target.value as "store_product_code" | "barcode")
                  }
                >
                  <option value="store_product_code">Item code / ID</option>
                  <option value="barcode">Barcode</option>
                </Select>
              </div>
              <div>
                <Label>Product reference column</Label>
                <Select value={referenceColumn} onChange={(e) => setReferenceColumn(e.target.value)}>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>RTC quantity column</Label>
                <Select value={quantityColumn} onChange={(e) => setQuantityColumn(e.target.value)}>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              GloPOS file: each file barcode is looked up in the catalog (
              product_barcodes → store item code). RTC is imported using{" "}
              <strong>{referenceColumn}</strong> and <strong>{quantityColumn}</strong>.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-xs">
              <thead className="bg-zinc-50">
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
                  <tr key={idx} className="border-t">
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
            disabled={
              Boolean(progress && !progress.done) ||
              (preview.mappingType === "store_product_code" &&
                preview.matchedCount === 0)
            }
          >
            Import RTC
          </Button>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-zinc-900">Saved RTC data</h3>
        {!storeId ? (
          <p className="text-sm text-zinc-600">Select a store to see RTC dates already saved.</p>
        ) : loadingRows ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : savedRows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-3 py-2">RTC date</th>
                  <th className="px-3 py-2">Products saved</th>
                  <th className="px-3 py-2">RTC qty</th>
                  <th className="px-3 py-2">Last updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.rtcDate}</td>
                    <td className="px-3 py-2 tabular-nums">{row.productCount.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDecimal(parseDbDecimal(row.totalRtcQty), 2)}
                    </td>
                    <td className="px-3 py-2">{row.lastUpdated.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deletingId === row.id}
                        onClick={() => onDeleteRow(row)}
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
          <p className="text-sm text-zinc-600">
            No RTC data saved for this store yet. Import a file to add data.
          </p>
        )}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
