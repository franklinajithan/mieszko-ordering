"use client";

import { useState } from "react";
import { importSupplierPrices, previewUpload } from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectKnownColumns } from "@/parsers/file-parser";
import type { FilePreview, ImportResult } from "@/types";

type Supplier = { id: number; code: string; name: string };

export function SupplierPriceImportForm({ suppliers }: { suppliers: Supplier[] }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [priceColumn, setPriceColumn] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    try {
      const selected = formData.get("file") as File;
      setFile(selected);
      const data = await previewUpload(formData);
      setPreview(data);

      const supplier = suppliers.find((s) => s.id === Number(supplierId));
      if (supplier) {
        const detected = detectKnownColumns(supplier.code, data.headers);
        setReferenceColumn(detected.referenceColumn ?? data.headers[0] ?? "");
        setPriceColumn(detected.priceColumn ?? data.headers[1] ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  function onSupplierChange(id: string) {
    setSupplierId(id);
    const numericId = Number(id);
    if (preview) {
      const supplier = suppliers.find((s) => s.id === numericId);
      if (supplier) {
        const detected = detectKnownColumns(supplier.code, preview.headers);
        setReferenceColumn(detected.referenceColumn ?? preview.headers[0] ?? "");
        setPriceColumn(detected.priceColumn ?? preview.headers[1] ?? "");
      }
    }
  }

  async function onImport() {
    if (!file || !supplierId) {
      setError("Select a supplier and file first");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("supplierId", supplierId);
    formData.set("referenceColumn", referenceColumn);
    formData.set("priceColumn", priceColumn);
    formData.set("effectiveDate", effectiveDate);

    const response = await importSupplierPrices(formData);
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
          <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
        </div>
        <div className="md:col-span-2">
          <Button type="submit">Preview file</Button>
        </div>
      </form>

      {preview ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Column mapping</h3>
          <div className="grid gap-3 md:grid-cols-3">
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
              <Select value={priceColumn} onChange={(e) => setPriceColumn(e.target.value)}>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Effective date</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
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

          <Button type="button" onClick={onImport}>
            Import supplier prices
          </Button>
        </div>
      ) : null}

      {result ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
