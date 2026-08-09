"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  applyStoredBookStockToOrder,
  listBookStockImports,
  uploadOrderStockFile,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOK_STOCK_COLUMNS } from "@/lib/import-config";
import type { ErpType, ImportResult } from "@/types";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

type BookStockUploadSummary = {
  bookStockDate: string;
  importedAt: string;
  itemCount: number;
  totalBookStockQty: string;
};

function formatUploadLabel(entry: BookStockUploadSummary, isLatest: boolean) {
  const when = new Date(entry.importedAt).toLocaleString();
  return `${when} — BK ${entry.bookStockDate} (${entry.itemCount} products)${
    isLatest ? " · latest" : ""
  }`;
}

export function OrderBookStockSection({
  orderId,
  storeId,
  erpType,
  onApplied,
}: {
  orderId: number;
  storeId: number;
  erpType: ErpType;
  onApplied: (label: string, result: ImportResult) => void;
}) {
  const [imports, setImports] = useState<BookStockUploadSummary[]>([]);
  const [selectedImportedAt, setSelectedImportedAt] = useState<string | null>(null);
  const [loadingImports, setLoadingImports] = useState(true);
  const [mode, setMode] = useState<"stored" | "upload">("stored");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const erpHelp = BOOK_STOCK_COLUMNS[erpType];
  const defaultReference = erpHelp.reference[0] ?? "Item Code";
  const defaultQuantity = erpHelp.quantity[0] ?? "Current Stock";

  const selectedImport = useMemo(
    () => imports.find((entry) => entry.importedAt === selectedImportedAt) ?? null,
    [imports, selectedImportedAt],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingImports(true);
    void listBookStockImports(storeId).then((response) => {
      if (cancelled) return;
      if (response.success && response.data.length) {
        setImports(response.data);
        setSelectedImportedAt(response.data[0].importedAt);
        setMode("stored");
      } else {
        setImports([]);
        setSelectedImportedAt(null);
        setMode("upload");
      }
      setLoadingImports(false);
    });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  async function applyStored() {
    if (!selectedImportedAt) return;
    setError(null);
    setApplying(true);
    const result = await applyStoredBookStockToOrder({
      orderId,
      importedAt: selectedImportedAt,
    });
    setApplying(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onApplied(
      `Book stock (${formatUploadLabel(selectedImport!, selectedImportedAt === imports[0]?.importedAt)})`,
      result.data,
    );
  }

  async function validateSelectedFile(selected: File) {
    const mismatch = await checkUploadErpMismatch(
      selected,
      erpType,
      detectBookStockFileErpType,
    );
    if (mismatch) {
      setError(mismatch);
      reportErpMismatch(mismatch);
      return false;
    }
    return true;
  }

  async function onUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const valid = await validateSelectedFile(selected);
    if (!valid) {
      event.target.value = "";
    }
  }

  async function handleUpload(formData: FormData) {
    setError(null);
    const file = formData.get("file");
    if (file instanceof File) {
      if (!(await validateSelectedFile(file))) {
        return;
      }
    }

    formData.set("orderId", String(orderId));
    formData.set("uploadType", "book_stock");
    formData.set("mappingType", "store_product_code");
    const result = await uploadOrderStockFile(formData);
    if (!result.success) {
      setError(result.error);
      reportErpMismatch(result.error);
      return;
    }
    onApplied("Book stock (new upload)", result.data);
  }

  if (loadingImports) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-zinc-600">
        Loading saved book stock…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h3 className="font-semibold">Book stock</h3>
        <p className="mt-1 text-sm text-zinc-600">{erpHelp.label}</p>
      </div>

      {imports.length ? (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
          <p className="font-medium text-emerald-900">
            Saved uploads for this store (latest first)
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bookStockMode"
                checked={mode === "stored"}
                onChange={() => setMode("stored")}
              />
              Use a saved upload by timestamp
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bookStockMode"
                checked={mode === "upload"}
                onChange={() => setMode("upload")}
              />
              Upload a new BK file instead
            </label>
          </div>

          {mode === "stored" ? (
            <div className="space-y-3">
              <div>
                <Label>Select upload</Label>
                <Select
                  value={selectedImportedAt ?? ""}
                  onChange={(e) => setSelectedImportedAt(e.target.value)}
                >
                  {imports.map((entry, index) => (
                    <option key={entry.importedAt} value={entry.importedAt}>
                      {formatUploadLabel(entry, index === 0)}
                    </option>
                  ))}
                </Select>
              </div>

              {selectedImport ? (
                <ul className="space-y-1 text-emerald-900/90">
                  <li>
                    Uploaded: {new Date(selectedImport.importedAt).toLocaleString()}
                  </li>
                  <li>Book-stock date: {selectedImport.bookStockDate}</li>
                  <li>Products: {selectedImport.itemCount}</li>
                </ul>
              ) : null}

              <Button
                type="button"
                disabled={applying || !selectedImportedAt}
                onClick={applyStored}
              >
                {applying ? "Applying…" : "Apply selected book stock"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          No saved book stock for this store yet. Upload a file below, or import one from
          the Book Stock menu first.
        </p>
      )}

      {mode === "upload" || !imports.length ? (
        <form action={handleUpload} className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Excel file</Label>
            <FileUploadField
              name="file"
              accept=".csv,.xlsx,.xls"
              required
              onChange={onUploadFileChange}
            />
          </div>
          <div>
            <Label>Product code column</Label>
            <Input name="referenceColumn" defaultValue={defaultReference} required />
          </div>
          <div>
            <Label>Quantity column</Label>
            <Input name="quantityColumn" defaultValue={defaultQuantity} required />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Upload & apply book stock</Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
