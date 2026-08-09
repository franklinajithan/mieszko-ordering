"use client";

import { useState, type ChangeEvent } from "react";
import {
  importSupplierPriceChunk,
  parseImportFile,
  SUPPLIER_PRICES_IMPORT_CHUNK_SIZE,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupplierPriceListPage } from "@/components/supplier-prices/supplier-price-list-page";
import { detectKnownColumns } from "@/parsers/file-parser";
import { parseSupplierPriceFileBuffer } from "@/parsers/supplier-prices/supplier-price-file-parser";
import type { FilePreview, ImportResult, ParsedRow } from "@/types";

type Supplier = { id: number; code: string; name: string };

type SupplierPriceImportProgress = {
  processed: number;
  total: number;
  fileName: string;
  supplierName: string;
  done: boolean;
};

function toDatetimeLocalValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date part → effectiveDate; full value → importedAt (ISO). */
function datetimeLocalToParts(value: string): {
  effectiveDate: string;
  importedAt: string;
} {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Select a valid import date and time");
  }
  return {
    effectiveDate: value.slice(0, 10),
    importedAt: parsed.toISOString(),
  };
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}

function mergeImportResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    ...a,
    totalRows: a.totalRows + b.totalRows,
    matchedRows: a.matchedRows + b.matchedRows,
    unmatchedRows: a.unmatchedRows + b.unmatchedRows,
    invalidRows: a.invalidRows + b.invalidRows,
    errors: [...a.errors, ...b.errors].slice(0, 50),
  };
}

function slimPriceRows(
  rows: ParsedRow[],
  referenceColumn: string,
  priceColumn: string,
  caseSizeColumn?: string,
): ParsedRow[] {
  return rows.map((row) => {
    const slim: ParsedRow = {
      [referenceColumn]: row[referenceColumn] ?? "",
      [priceColumn]: row[priceColumn] ?? "",
      __rowNumber: row.__rowNumber ?? "",
    };
    if (caseSizeColumn) {
      slim[caseSizeColumn] = row[caseSizeColumn] ?? "";
    }
    return slim;
  });
}

export function SupplierPriceImportForm({ suppliers }: { suppliers: Supplier[] }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [priceColumn, setPriceColumn] = useState("");
  const [caseSizeColumn, setCaseSizeColumn] = useState("");
  const [importedAtLocal, setImportedAtLocal] = useState(toDatetimeLocalValue);
  const [progress, setProgress] = useState<SupplierPriceImportProgress | null>(
    null,
  );
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const selectedSupplier =
    suppliers.find((s) => String(s.id) === supplierId) ?? null;

  function applyDetectedColumns(supplierCode: string, headers: string[]) {
    const detected = detectKnownColumns(supplierCode, headers);
    setReferenceColumn(detected.referenceColumn ?? headers[0] ?? "");
    setPriceColumn(detected.priceColumn ?? headers[1] ?? "");
    setCaseSizeColumn(detected.caseSizeColumn ?? "");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setPreview(null);
    setResult(null);
    setFile(selected);
    if (selected) setError(null);
  }

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      if (!supplierId) {
        setError("Select a supplier before previewing the file.");
        return;
      }
      const selected = formData.get("file") as File;
      setFile(selected);
      const data = await parseImportFile(formData);
      setPreview(data);
      const supplier = suppliers.find((s) => s.id === Number(supplierId));
      if (supplier) {
        applyDetectedColumns(supplier.code, data.headers);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  function onSupplierChange(id: string) {
    setSupplierId(id);
    setPreview(null);
    setResult(null);
  }

  async function onImport() {
    if (!file || !supplierId) {
      setError("Select a supplier and file first");
      return;
    }
    if (!referenceColumn || !priceColumn) {
      setError("Select supplier reference and net price columns");
      return;
    }

    let effectiveDate: string;
    let importedAt: string;
    try {
      const parts = datetimeLocalToParts(importedAtLocal);
      effectiveDate = parts.effectiveDate;
      importedAt = parts.importedAt;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Select a valid import date and time",
      );
      return;
    }

    const supplierName = selectedSupplier?.name ?? "";
    setError(null);
    setResult(null);

    try {
      const parsed = await parseSupplierPriceFileBuffer(
        await file.arrayBuffer(),
        file.name,
      );
      if (!parsed.rows.length) {
        setError("No price rows found in the file.");
        return;
      }

      const caseCol = caseSizeColumn || undefined;
      const slimRows = slimPriceRows(
        parsed.rows,
        referenceColumn,
        priceColumn,
        caseCol,
      );
      const batches = chunkRows(slimRows, SUPPLIER_PRICES_IMPORT_CHUNK_SIZE);
      const totalRows = slimRows.length;

      setProgress({
        processed: 0,
        total: totalRows,
        fileName: file.name,
        supplierName,
        done: false,
      });

      let aggregated: ImportResult = {
        totalRows: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        invalidRows: 0,
        errors: [],
      };
      let processed = 0;

      for (const batch of batches) {
        const chunk = await importSupplierPriceChunk({
          supplierId: Number(supplierId),
          referenceColumn,
          priceColumn,
          caseSizeColumn: caseCol,
          effectiveDate,
          importedAt,
          fileName: file.name,
          rows: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          setProgress(null);
          return;
        }
        aggregated = mergeImportResults(aggregated, chunk.data);
        processed += batch.length;
        setProgress({
          processed,
          total: totalRows,
          fileName: file.name,
          supplierName,
          done: processed >= totalRows,
        });
      }

      setResult(aggregated);
      setPreview(null);
      setProgress(null);
      setListRefreshKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setProgress(null);
    }
  }

  const progressPercent = progress
    ? Math.round((progress.processed / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Import supplier code, net price, and case size (MM{" "}
        <strong>Package</strong>, SP/WAB <strong>Jednostek</strong>). Set import
        date &amp; time so multiple uploads on the same day stay distinct;
        ordering always uses the latest timestamp.
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <form
          action={onPreview}
          className="grid gap-4 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-sm"
        >
          <div>
            <Label>Supplier</Label>
            <Select
              name="supplierId"
              required
              value={supplierId}
              onChange={(e) => onSupplierChange(e.target.value)}
            >
              <option value="" disabled>
                Select supplier
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.code})
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
                  ? "Supplier prices import complete"
                  : "Saving supplier prices…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.supplierName}
              </p>
              <div
                className="h-3 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
                aria-label="Supplier prices import progress"
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
                {progress.total.toLocaleString()} price rows · {progressPercent}%
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
              <div className="grid gap-3">
                <div>
                  <Label>Supplier reference column</Label>
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
                  <Label>Net price column</Label>
                  <Select
                    value={priceColumn}
                    onChange={(e) => setPriceColumn(e.target.value)}
                  >
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Case size column</Label>
                  <Select
                    value={caseSizeColumn}
                    onChange={(e) => setCaseSizeColumn(e.target.value)}
                  >
                    <option value="">None</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Import date &amp; time</Label>
                  <Input
                    type="datetime-local"
                    required
                    value={importedAtLocal}
                    onChange={(e) => setImportedAtLocal(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Date is used as effective date; full time marks this upload
                    for latest-price selection.
                  </p>
                </div>
              </div>
              <Button type="button" onClick={() => void onImport()}>
                Import supplier prices
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

      <SupplierPriceListPage refreshKey={listRefreshKey} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
