"use client";

import { useState } from "react";
import { importDailySales, previewUpload } from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectSalesColumns } from "@/parsers/file-parser";
import type { FilePreview, ImportResult } from "@/types";

type Store = { id: string; name: string };

export function DailySalesImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
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

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    try {
      const selected = formData.get("file") as File;
      setFile(selected);
      const data = await previewUpload(formData);
      setPreview(data);
      const detected = detectSalesColumns(data.headers);
      setProductColumn(detected.productColumn ?? data.headers[0] ?? "");
      setQuantityColumn(detected.quantityColumn ?? data.headers[1] ?? "");
      setDateColumn(detected.dateColumn ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  async function onImport() {
    if (!file || !storeId) {
      setError("Select a store and file first");
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
      return;
    }
    setResult(response.data);
  }

  return (
    <div className="space-y-6">
      <form action={onPreview} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-2">
        <div>
          <Label>Store</Label>
          <Select
            name="storeId"
            required
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="" disabled>
              Select store
            </option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>CSV or XLSX file</Label>
          <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
        </div>
        <div className="md:col-span-2">
          <Button type="submit">Preview file</Button>
        </div>
      </form>

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Column mapping</h3>
          <div className="grid gap-3 md:grid-cols-2">
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
            <div>
              <Label>Manual sales date</Label>
              <Input
                type="date"
                value={manualSalesDate}
                onChange={(e) => setManualSalesDate(e.target.value)}
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
