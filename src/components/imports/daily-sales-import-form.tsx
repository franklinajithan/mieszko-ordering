"use client";

import { useState, type ChangeEvent } from "react";
import { importDailySales, previewDailySalesUpload } from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectSalesColumns } from "@/parsers/file-parser";
import type { ImportResult } from "@/types";
import {
  detectDailySalesFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

type Store = { id: number; name: string; erpType: string };

type PreviewState = {
  headers: string[];
  rows: Record<string, string>[];
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export function DailySalesImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mappingType, setMappingType] = useState<"store_product_code" | "barcode">(
    "store_product_code",
  );
  const [productColumn, setProductColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [manualSalesDate, setManualSalesDate] = useState("");
  const [storeId, setStoreId] = useState("");

  const isRetailFormat = preview?.productColumn === "Item Code";

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
      setDateColumn(detected.dateColumn ?? "");
      if (data.manualSalesDate) setManualSalesDate(data.manualSalesDate);
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
    if (!(await validateSelectedFile(file))) {
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("storeId", storeId);
    formData.set("mappingType", mappingType);
    formData.set("productColumn", productColumn);
    formData.set("quantityColumn", quantityColumn);
    if (dateColumn) formData.set("dateColumn", dateColumn);
    if (manualSalesDate) formData.set("manualSalesDate", manualSalesDate);

    const response = await importDailySales(formData);
    if (!response.success) {
      setError(response.error);
      reportErpMismatch(response.error);
      return;
    }
    setResult(response.data);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        MSP stores use BK files with <strong>ID</strong> + <strong>Qty</strong>. Product Sales
        Enquiry files (for example <strong>16.07.xlsx</strong>) are detected automatically —
        sales are grouped by <strong>Item Code</strong> and only <strong>Sales Qty</strong> is
        imported.
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
          <Input
            name="file"
            type="file"
            accept=".csv,.xlsx,.xls"
            required
            onChange={onFileChange}
          />
        </div>
        <div className="md:col-span-2">
          <Button type="submit">Preview file</Button>
        </div>
      </form>

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
              Grouped {preview.duplicateRows} duplicate Item Code rows before import.
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {!isRetailFormat ? (
              <div>
                <Label>Mapping type</Label>
                <Select
                  value={mappingType}
                  onChange={(e) =>
                    setMappingType(e.target.value as "store_product_code" | "barcode")
                  }
                >
                  <option value="store_product_code">Store product code</option>
                  <option value="barcode">Barcode</option>
                </Select>
              </div>
            ) : null}
            <div>
              <Label>Product reference column</Label>
              <Select
                value={productColumn}
                onChange={(e) => setProductColumn(e.target.value)}
              >
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
            {!isRetailFormat ? (
              <div>
                <Label>Sales date column</Label>
                <Select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                  <option value="">Use manual date below</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div>
              <Label>{isRetailFormat ? "Detected sales date" : "Manual sales date"}</Label>
              <Input
                type="date"
                value={manualSalesDate}
                onChange={(e) => setManualSalesDate(e.target.value)}
                required={isRetailFormat}
              />
            </div>
            <div>
              <Label>Sold quantity column</Label>
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

          <Button type="button" onClick={onImport}>
            Import daily sales
          </Button>
        </div>
      ) : null}

      {result ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
