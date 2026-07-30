"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  deleteWastageUpload,
  importWastage,
  listWastageSummaries,
  previewWastageUpload,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectWastageColumns } from "@/parsers/file-parser";
import type { ImportResult } from "@/types";
import type { Store, WastagePreviewState, WastageSavedRow } from "@/types/wastage";
import {
  detectWastageFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";

function isGloposWastagePreview(preview: WastagePreviewState): boolean {
  return preview.skippedExcludedReasonRows !== undefined;
}

export function WastageImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<WastagePreviewState | null>(null);
  const [result, setResult] = useState<(ImportResult & { importId?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [wastageDate, setWastageDate] = useState("");
  const [excelWastageDate, setExcelWastageDate] = useState("");
  const [mappingType, setMappingType] = useState<"store_product_code" | "barcode">(
    "store_product_code",
  );
  const [savedRows, setSavedRows] = useState<WastageSavedRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [importing, setImporting] = useState(false);

  function savedRowKey(forStoreId: string, forWastageDate: string) {
    return `${forStoreId}|${forWastageDate}`;
  }

  async function loadSavedRows(forStoreId: string) {
    if (!forStoreId) {
      setSavedRows([]);
      return;
    }
    setLoadingRows(true);
    const response = await listWastageSummaries(Number(forStoreId));
    setLoadingRows(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const store = stores.find((s) => String(s.id) === forStoreId);
    setSavedRows(
      response.data.map((row) => ({
        id: savedRowKey(forStoreId, row.wastageDate),
        storeId: forStoreId,
        storeName: store?.name ?? "",
        wastageDate: row.wastageDate,
        productCount: row.itemCount,
        totalWastageQty: row.totalWastageQty,
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
      detectWastageFileErpType,
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
    setExcelWastageDate("");
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
      const data = await previewWastageUpload(formData);
      setPreview(data);
      const selectedStore = stores.find((store) => String(store.id) === storeId);
      const erpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
      const detected = detectWastageColumns(data.headers, erpType);
      setReferenceColumn(
        data.referenceColumn ?? detected.referenceColumn ?? data.headers[0] ?? "",
      );
      setQuantityColumn(
        data.quantityColumn ?? detected.quantityColumn ?? data.headers[1] ?? "",
      );
      if (data.mappingType) setMappingType(data.mappingType);
      if (data.wastageDate) {
        setExcelWastageDate(data.wastageDate);
        setWastageDate(data.wastageDate);
      } else {
        setExcelWastageDate("");
        if (!wastageDate) {
          setWastageDate(new Date().toISOString().slice(0, 10));
        }
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
    if (!wastageDate) {
      setError("Select a wastage date");
      return;
    }
    if (
      preview &&
      gloposParsed &&
      preview.matchedCount !== undefined &&
      preview.matchedCount === 0
    ) {
      setError(
        "No file products matched this store's catalog. Import or update products for this store, then preview again.",
      );
      return;
    }
    if (!(await validateSelectedFile(file))) {
      return;
    }
    setError(null);
    setResult(null);
    setImporting(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("storeId", storeId);
    formData.set("wastageDate", wastageDate);
    formData.set("mappingType", mappingType);
    formData.set("referenceColumn", referenceColumn);
    formData.set("quantityColumn", quantityColumn);

    const response = await importWastage(formData);
    setImporting(false);
    if (!response.success) {
      setError(response.error);
      reportErpMismatch(response.error);
      return;
    }
    setResult(response.data);
    setPreview(null);
    if (response.data.matchedRows === 0 && response.data.totalRows > 0) {
      setError(
        "Import finished but no products matched. Ensure each product code in the file exists on the store catalog.",
      );
    }
    await loadSavedRows(storeId);
  }

  async function onDeleteRow(row: WastageSavedRow) {
    if (
      !window.confirm(
        `Delete all saved wastage data for ${row.storeName} on ${row.wastageDate}?`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    setError(null);
    const response = await deleteWastageUpload(Number(row.storeId), row.wastageDate);
    setDeletingId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSavedRows(row.storeId);
  }

  const gloposParsed = preview ? isGloposWastagePreview(preview) : false;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Upload GloPOS <strong>WastageReport</strong> exports (product code + qty) or legacy
        wastage spreadsheets. GloPOS reports skip transfer in/out, credit note, and store-use
        reason sections automatically. Products are matched by item code or barcode for the
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
                    detectWastageFileErpType,
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
          {importing ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-zinc-900">Import progress</h3>
              <p className="font-medium text-zinc-900">Saving wastage quantities…</p>
              <p className="text-sm text-zinc-600">{file?.name ?? "Upload"}</p>
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
              Grouped {preview.duplicateRows} duplicate product rows (quantities summed) before
              import.
            </p>
          ) : null}
          {gloposParsed && preview.matchedCount !== undefined ? (
            <p
              className={
                preview.matchedCount > 0 ? "text-sm text-emerald-800" : "text-sm text-red-700"
              }
            >
              Catalog lookup: {preview.matchedCount} product
              {preview.matchedCount === 1 ? "" : "s"} matched to store item codes
              {preview.unmatchedCount ?
                ` · ${preview.unmatchedCount} unmatched`
              : ""}
              .
            </p>
          ) : null}
          {preview.unmatchedCodes?.length ? (
            <p className="text-xs text-zinc-600">
              Unmatched product codes (sample): {preview.unmatchedCodes.join(", ")}
            </p>
          ) : null}
          {gloposParsed && preview.skippedExcludedReasonRows ?
            <p className="text-sm text-emerald-800">
              Skipped {preview.skippedExcludedReasonRows} rows under excluded reasons (transfers,
              credit note, store use, stock corrections).
            </p>
          : null}
          <div className="max-w-sm">
            <Label>Wastage date</Label>
            {excelWastageDate ? (
              <p className="mb-1.5 text-xs text-zinc-500">
                Prefilled from the Excel report ({excelWastageDate}). Change below if you need a
                different date.
              </p>
            ) : null}
            <DateField
              value={wastageDate}
              onChange={(e) => setWastageDate(e.target.value)}
              required
            />
            {excelWastageDate && wastageDate !== excelWastageDate ? (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                onClick={() => setWastageDate(excelWastageDate)}
              >
                Reset to Excel date
              </button>
            ) : null}
          </div>
          {gloposParsed ? (
            <p className="text-sm text-zinc-600">
              GloPOS WastageReport: only countable wastage lines are imported using{" "}
              <strong>{referenceColumn}</strong> and <strong>{quantityColumn}</strong>.
            </p>
          ) : (
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
                <Label>Wastage quantity column</Label>
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
              importing ||
              (gloposParsed &&
                preview.matchedCount !== undefined &&
                preview.matchedCount === 0)
            }
          >
            Import wastage
          </Button>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-zinc-900">Saved wastage data</h3>
        {!storeId ? (
          <p className="text-sm text-zinc-600">
            Select a store to see wastage dates already saved.
          </p>
        ) : loadingRows ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : savedRows.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-3 py-2">Wastage date</th>
                  <th className="px-3 py-2">Products saved</th>
                  <th className="px-3 py-2">Wastage qty</th>
                  <th className="px-3 py-2">Last updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.wastageDate}</td>
                    <td className="px-3 py-2 tabular-nums">{row.productCount.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatDecimal(parseDbDecimal(row.totalWastageQty), 2)}
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
            No wastage data saved for this store yet. Import a file to add data.
          </p>
        )}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
