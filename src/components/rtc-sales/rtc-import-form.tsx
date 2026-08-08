"use client";

import { useState, type ChangeEvent } from "react";
import {
  importRtcChunk,
  matchRtcBarcodes,
  parseRtcFile,
  RTC_IMPORT_CHUNK_SIZE,
} from "@/lib/api";
import { RTC_ITEM_CODE_COLUMN } from "@/lib/import-config";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RtcSalesListPage } from "@/components/rtc-sales/rtc-sales-list-page";
import { detectRtcColumns } from "@/parsers/file-parser";
import { parseRtcFileBuffer } from "@/parsers/rtc-file-parser";
import {
  prepareRtcImport,
  remapRtcBarcodeRowsToStoreProductCodes,
} from "@/services/rtc-import-prepare";
import type { ImportResult } from "@/types";
import {
  detectRtcFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { decimalToDb } from "@/utils/decimal";
import type { RtcImportProgress, RtcPreviewState, Store } from "@/types/rtc";

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

export function RtcImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<RtcPreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
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
  const [progress, setProgress] = useState<RtcImportProgress | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

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
      const data = await parseRtcFile(formData);
      setPreview(data);
      const selectedStore = stores.find((store) => String(store.id) === storeId);
      const erpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
      const detected = detectRtcColumns(data.headers, erpType);
      setReferenceColumn(
        data.referenceColumn ?? detected.referenceColumn ?? data.headers[0] ?? "",
      );
      setQuantityColumn(
        data.quantityColumn ?? detected.quantityColumn ?? data.headers[1] ?? "",
      );
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

    const store = stores.find((s) => String(s.id) === storeId);
    const storeName = store?.name ?? "";
    const erpType = store?.erpType === "glopos" ? "glopos" : "msp";
    setError(null);
    setResult(null);

    try {
      const parsed = await parseRtcFileBuffer(
        await file.arrayBuffer(),
        file.name,
        erpType,
      );
      const qtyColumn =
        quantityColumn ||
        parsed.quantityColumn ||
        detectRtcColumns(parsed.headers, erpType).quantityColumn ||
        "";
      if (!qtyColumn) {
        setError("Could not detect the RTC quantity column.");
        return;
      }

      let importRows = parsed.rows;
      let codeColumn =
        referenceColumn ||
        parsed.referenceColumn ||
        detectRtcColumns(parsed.headers, erpType).referenceColumn ||
        "";
      let prepResult: ImportResult = {
        totalRows: parsed.rows.length,
        matchedRows: 0,
        unmatchedRows: 0,
        invalidRows: 0,
        duplicateRows: parsed.duplicateRows ?? 0,
        errors: [],
      };

      const useBarcodeLookup =
        parsed.barcodeMapped || mappingType === "barcode";

      if (useBarcodeLookup) {
        const barcodeColumn = parsed.referenceColumn || referenceColumn;
        if (!barcodeColumn) {
          setError("Could not detect the barcode column.");
          return;
        }
        const barcodes = parsed.rows
          .map((row) => formatSpreadsheetBarcode(row[barcodeColumn]).trim())
          .filter(Boolean);
        const matched = await matchRtcBarcodes({
          storeId: Number(storeId),
          barcodes,
        });
        if (!matched.success) {
          setError(matched.error);
          return;
        }
        const remapped = remapRtcBarcodeRowsToStoreProductCodes({
          barcodeColumn,
          quantityColumn: qtyColumn,
          rows: parsed.rows,
          matches: matched.data,
        });
        if (!remapped.rows.length) {
          setError(
            remapped.unmatchedBarcodes.length
              ? `No store products found for file barcodes (${remapped.unmatchedBarcodes.length} unmatched). Add barcodes to this store's catalog, then try again.`
              : "No RTC product rows found in the file.",
          );
          return;
        }
        importRows = remapped.rows;
        codeColumn = RTC_ITEM_CODE_COLUMN;
        prepResult = {
          ...prepResult,
          totalRows: remapped.rows.length,
          unmatchedRows: remapped.unmatchedBarcodes.length,
          duplicateRows: parsed.duplicateRows ?? 0,
        };
      } else {
        if (!codeColumn) {
          setError("Could not detect the product reference column.");
          return;
        }
        const prepared = prepareRtcImport({
          referenceColumn: codeColumn,
          quantityColumn: qtyColumn,
          rows: parsed.rows,
        });
        if (!prepared.rows.length) {
          setError("No valid RTC rows found in the file.");
          setResult(prepared.result);
          return;
        }
        importRows = prepared.rows.map((row) => ({
          [codeColumn]: row.reference,
          [qtyColumn]: decimalToDb(row.qty),
          __productName: row.productName ?? "",
          __rowNumber: String(row.rowNumber),
        }));
        prepResult = prepared.result;
      }

      const slimRows = importRows.map((row) => ({
        [codeColumn]: row[codeColumn] ?? "",
        [qtyColumn]: row[qtyColumn] ?? "",
        __productName: row.__productName ?? "",
        __rowNumber: row.__rowNumber ?? "",
      }));

      const batches = chunkRows(slimRows, RTC_IMPORT_CHUNK_SIZE);
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
        unmatchedRows: prepResult.unmatchedRows,
      };
      let processed = 0;

      for (const batch of batches) {
        const chunk = await importRtcChunk({
          storeId: Number(storeId),
          rtcDate,
          referenceColumn: codeColumn,
          quantityColumn: qtyColumn,
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

      setProgress(null);
      setResult(aggregated);
      setPreview(null);
      if (aggregated.matchedRows === 0 && aggregated.totalRows > 0) {
        setError(
          "Import finished but no products matched. Ensure each file barcode exists on this store's catalog (store product barcodes → item code).",
        );
      }
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
        Upload GloPOS <strong>Price Override &amp; RTC Sales History</strong> reports
        (barcode + qty) or legacy RTC spreadsheets. Products are matched by barcode or
        item code for the selected store.
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
                aria-label="RTC import progress"
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
                {progress.total.toLocaleString()} RTC rows · {progressPercent}%
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
              {preview.duplicateRows ? (
                <p className="text-sm text-emerald-800">
                  Grouped {preview.duplicateRows} duplicate barcode rows
                  (quantities summed) before import.
                </p>
              ) : null}
              {preview.mappingType === "store_product_code" &&
              preview.matchedCount !== undefined ? (
                <p
                  className={
                    preview.matchedCount > 0
                      ? "text-sm text-emerald-800"
                      : "text-sm text-red-700"
                  }
                >
                  Catalog lookup: {preview.matchedCount} barcode
                  {preview.matchedCount === 1 ? "" : "s"} resolved to store item
                  codes
                  {preview.unmatchedCount
                    ? ` · ${preview.unmatchedCount} unmatched`
                    : ""}
                  .
                </p>
              ) : null}
              {preview.unmatchedBarcodes?.length ? (
                <p className="text-xs text-zinc-600">
                  Unmatched barcodes (sample):{" "}
                  {preview.unmatchedBarcodes.join(", ")}
                </p>
              ) : null}
              <div className="max-w-sm">
                <Label>RTC date</Label>
                {excelRtcDate ? (
                  <p className="mb-1.5 text-xs text-zinc-500">
                    Prefilled from the Excel report ({excelRtcDate}). Change below
                    if you need a different date.
                  </p>
                ) : null}
                <DateField
                  value={rtcDate}
                  onChange={(e) => setRtcDate(e.target.value)}
                  required
                />
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
                <div className="grid gap-3">
                  <div>
                    <Label>Match products by</Label>
                    <Select
                      value={mappingType}
                      onChange={(e) =>
                        setMappingType(
                          e.target.value as "store_product_code" | "barcode",
                        )
                      }
                    >
                      <option value="store_product_code">Item code / ID</option>
                      <option value="barcode">Barcode</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Product reference column</Label>
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
                    <Label>RTC quantity column</Label>
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
              ) : (
                <p className="text-sm text-zinc-600">
                  GloPOS file: each file barcode is looked up in the catalog
                  (store product barcodes → item code). RTC is imported using{" "}
                  <strong>{referenceColumn}</strong> and{" "}
                  <strong>{quantityColumn}</strong>.
                </p>
              )}
              <Button
                type="button"
                onClick={onImport}
                disabled={
                  preview.mappingType === "store_product_code" &&
                  preview.matchedCount === 0
                }
              >
                Import RTC
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

      <RtcSalesListPage
        storeId={storeId}
        stores={stores}
        refreshKey={listRefreshKey}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
