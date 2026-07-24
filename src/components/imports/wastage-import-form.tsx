"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { importWastage, listWastageImports, previewUpload } from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectWastageColumns } from "@/parsers/file-parser";
import { BOOK_STOCK_COLUMNS, type ErpType, type FilePreview, type ImportResult } from "@/types";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

type Store = { id: number; name: string; code: string; erpType: string };
type WastageImport = {
  importId: number;
  fileName: string | null;
  wastageDate: string;
  importedAt: Date;
  itemCount: number;
};

export function WastageImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [result, setResult] = useState<(ImportResult & { importId?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [imports, setImports] = useState<WastageImport[]>([]);
  const [wastageDate, setWastageDate] = useState(new Date().toISOString().slice(0, 10));

  const selectedStore = useMemo(
    () => stores.find((store) => String(store.id) === storeId) ?? null,
    [stores, storeId],
  );
  const erpType: ErpType = selectedStore?.erpType === "glopos" ? "glopos" : "msp";
  const erpHelp = BOOK_STOCK_COLUMNS[erpType];
  const storeErpType = resolveStoreErpType(selectedStore?.erpType);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const mismatch = await checkUploadErpMismatch(
      selected,
      storeErpType,
      detectBookStockFileErpType,
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

  useEffect(() => {
    if (!storeId) {
      setImports([]);
      return;
    }
    void listWastageImports(Number(storeId)).then((response) => {
      if (response.success) setImports(response.data);
    });
  }, [storeId, result]);

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const selected = formData.get("file") as File;
      if (!storeId) {
        setError("Select a store before previewing the file.");
        return;
      }
      setFile(selected);
      const mismatch = await checkUploadErpMismatch(
        selected,
        storeErpType,
        detectBookStockFileErpType,
      );
      if (mismatch) {
        setError(mismatch);
        reportErpMismatch(mismatch);
        return;
      }
      const data = await previewUpload(formData);
      setPreview(data);
      const detected = detectWastageColumns(data.headers, erpType);
      setReferenceColumn(detected.referenceColumn ?? data.headers[0] ?? "");
      setQuantityColumn(detected.quantityColumn ?? data.headers[1] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
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
    formData.set("wastageDate", wastageDate);
    formData.set("referenceColumn", referenceColumn);
    formData.set("quantityColumn", quantityColumn);

    const response = await importWastage(formData);
    if (!response.success) {
      setError(response.error);
      reportErpMismatch(response.error);
      return;
    }
    setResult(response.data);
    setPreview(null);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Upload wastage by store and date. Product codes are matched to the store catalog
        using <strong>{erpHelp.label}</strong> column layouts (same as book stock). GloPOS
        files must go to GloPOS stores; MSP files to MSP stores.
      </p>

      <form
        action={onPreview}
        className="grid gap-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm md:grid-cols-2"
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
                  detectBookStockFileErpType,
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
                {store.name} ({store.code}) —{" "}
                {store.erpType === "glopos" ? "GloPOS" : "MSP"}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Wastage date</Label>
          <DateField
            name="wastageDate"
            value={wastageDate}
            onChange={(e) => setWastageDate(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <Label>Excel file (CSV or XLSX)</Label>
          <FileUploadField
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            onChange={onFileChange}
          />
        </div>
        <div className="md:col-span-2">
          <Button type="submit" disabled={!storeId}>
            Preview file
          </Button>
        </div>
      </form>

      {imports.length ? (
        <section className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-zinc-900">Import history (newest first)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-3 py-2">Imported at</th>
                  <th className="px-3 py-2">Wastage date</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Products</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((entry) => (
                  <tr key={entry.importId} className="border-t">
                    <td className="px-3 py-2">
                      {new Date(entry.importedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{entry.wastageDate}</td>
                    <td className="px-3 py-2">{entry.fileName ?? "—"}</td>
                    <td className="px-3 py-2">{entry.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-zinc-900">Column mapping</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Product code column</Label>
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

          {erpType === "glopos" ? (
            <p className="text-sm text-amber-800">
              Duplicate item codes in GloPOS files are summed automatically before import.
            </p>
          ) : null}

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

          <Button type="button" onClick={onImport}>
            Import wastage
          </Button>
        </div>
      ) : null}

      {result ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
