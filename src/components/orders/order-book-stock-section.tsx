"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyStoredBookStockToOrder,
  listBookStockImports,
  uploadOrderStockFile,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOK_STOCK_COLUMNS, type ErpType, type ImportResult } from "@/types";

type BookStockImport = {
  importId: number;
  fileName: string | null;
  bookStockDate: string;
  importedAt: Date;
  itemCount: number;
};

function formatImportLabel(entry: BookStockImport) {
  const when = new Date(entry.importedAt).toLocaleString();
  const file = entry.fileName ?? "Import";
  return `${when} — ${file} (${entry.itemCount} products)`;
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
  const [imports, setImports] = useState<BookStockImport[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<number | null>(null);
  const [loadingImports, setLoadingImports] = useState(true);
  const [mode, setMode] = useState<"stored" | "upload">("stored");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const erpHelp = BOOK_STOCK_COLUMNS[erpType];
  const defaultReference = erpHelp.reference[0] ?? "ID";
  const defaultQuantity = erpHelp.quantity[0] ?? "Qty";

  const selectedImport = useMemo(
    () => imports.find((entry) => entry.importId === selectedImportId) ?? null,
    [imports, selectedImportId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingImports(true);
    void listBookStockImports(storeId).then((response) => {
      if (cancelled) return;
      if (response.success && response.data.length) {
        setImports(response.data);
        setSelectedImportId(response.data[0].importId);
        setMode("stored");
      } else {
        setImports([]);
        setSelectedImportId(null);
        setMode("upload");
      }
      setLoadingImports(false);
    });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  async function applyStored() {
    if (!selectedImportId) return;
    setError(null);
    setApplying(true);
    const result = await applyStoredBookStockToOrder({
      orderId,
      importId: selectedImportId,
    });
    setApplying(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onApplied(`Book stock (${formatImportLabel(selectedImport!)})`, result.data);
  }

  async function handleUpload(formData: FormData) {
    setError(null);
    formData.set("orderId", String(orderId));
    formData.set("uploadType", "book_stock");
    formData.set("mappingType", "store_product_code");
    const result = await uploadOrderStockFile(formData);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onApplied("Book stock (new upload)", result.data);
  }

  if (loadingImports) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-zinc-600">
        Loading stored book stock imports…
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
          <p className="font-medium text-emerald-900">Stored imports for this store</p>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bookStockMode"
                checked={mode === "stored"}
                onChange={() => setMode("stored")}
              />
              Use a stored import
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
                <Label>Select import by timestamp</Label>
                <Select
                  value={selectedImportId ? String(selectedImportId) : ""}
                  onChange={(e) => setSelectedImportId(Number(e.target.value))}
                >
                  {imports.map((entry) => (
                    <option key={entry.importId} value={entry.importId}>
                      {formatImportLabel(entry)} — BK {entry.bookStockDate}
                    </option>
                  ))}
                </Select>
              </div>

              {selectedImport ? (
                <ul className="space-y-1 text-emerald-900/90">
                  <li>Imported: {new Date(selectedImport.importedAt).toLocaleString()}</li>
                  <li>Book-stock date: {selectedImport.bookStockDate}</li>
                  <li>Products matched: {selectedImport.itemCount}</li>
                </ul>
              ) : null}

              <Button type="button" disabled={applying || !selectedImportId} onClick={applyStored}>
                {applying ? "Applying…" : "Apply selected book stock"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          No stored book stock for this store yet. Upload a file below, or import one from
          the Book Stock menu first.
        </p>
      )}

      {mode === "upload" || !imports.length ? (
        <form action={handleUpload} className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>BK file</Label>
            <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
          </div>
          <div>
            <Label>Product code column</Label>
            <Input name="referenceColumn" defaultValue={defaultReference} required />
          </div>
          <div>
            <Label>Quantity column</Label>
            <Input name="quantityColumn" defaultValue={defaultQuantity} required />
          </div>
          {erpType === "glopos" ? (
            <p className="md:col-span-2 text-sm text-amber-800">
              GloPOS files are pivoted automatically: Current Stock is summed by Item
              Code.
            </p>
          ) : null}
          <div className="md:col-span-2">
            <Button type="submit">Upload book stock for this order</Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
