"use client";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { flushSync } from "react-dom";
import {
  addStoreProduct,
  beginProductImportFromRows,
  createProduct,
  runProductImportBatch,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import {
  ProductImportProgressInline,
  useProductImport,
} from "@/components/products/product-import-context";
import {
  detectProductFileColumns,
  parseProductFileBuffer,
} from "@/parsers/product-file-parser";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportResult } from "@/types";
import {
  detectProductFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

type Store = { id: number; name: string; erpType: string };

export function ProductForms({
  stores,
}: {
  stores: Store[];
}) {
  const router = useRouter();
  const { updateProgress, resetStatus } = useProductImport();
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  async function validateSelectedFile(file: File | null, selectedStoreId: string) {
    if (!file || !selectedStoreId) return true;
    const selectedStore = stores.find(
      (store) => String(store.id) === selectedStoreId,
    );
    const storeErpType = resolveStoreErpType(selectedStore?.erpType);
    const mismatch = await checkUploadErpMismatch(
      file,
      storeErpType,
      detectProductFileErpType,
    );
    if (mismatch) {
      setError(mismatch);
      reportErpMismatch(mismatch);
      return false;
    }
    return true;
  }

  async function onImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setImportResult(null);
    if (!selected) {
      setImportFile(null);
      return;
    }

    const selectedStoreId = storeId;
    if (!selectedStoreId) {
      setImportFile(selected);
      return;
    }

    const valid = await validateSelectedFile(selected, selectedStoreId);
    if (!valid) {
      event.target.value = "";
      setImportFile(null);
      return;
    }

    setError(null);
    setImportFile(selected);
  }

  async function createMasterProduct(formData: FormData) {
    setError(null);
    const productResult = await createProduct({
      name: formData.get("name"),
      department: formData.get("department"),
      isActive: true,
    });
    if (!productResult.success) {
      setError(productResult.error);
      return;
    }

    const mappingResult = await addStoreProduct({
      storeId: formData.get("storeId"),
      productId: productResult.data.id,
      storeProductCode: formData.get("storeProductCode"),
      isActive: true,
    });

    if (!mappingResult.success) {
      setError(mappingResult.error);
      return;
    }

    router.refresh();
  }

  async function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const selectedStoreId = String(formData.get("storeId") ?? storeId);
    const file = formData.get("file");
    const storeName =
      stores.find((store) => String(store.id) === selectedStoreId)?.name ??
      "Store";

    if (!(file instanceof File) || !file.size) {
      setError("Please choose an Excel file to import.");
      return;
    }

    if (!(await validateSelectedFile(file, selectedStoreId))) {
      return;
    }

    if (!selectedStoreId) {
      setError("Please select a store.");
      return;
    }

    flushSync(() => {
      setError(null);
      setImportResult(null);
      setImporting(true);
      resetStatus();
      updateProgress({
        phase: "parsing",
        fileName: file.name,
        storeName,
        processed: 0,
        total: 0,
        estimated: false,
        message: `Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`,
      });
    });

    try {
      const buffer = await file.arrayBuffer();
      const { headers, rows } = parseProductFileBuffer(buffer, file.name);
      const columns = detectProductFileColumns(headers);

      const selectedStore = stores.find(
        (store) => String(store.id) === selectedStoreId,
      );
      const storeErpType = resolveStoreErpType(selectedStore?.erpType);
      const fileErpType = detectProductFileErpType(headers);
      const erpMismatch = validateErpFileMatch(fileErpType, storeErpType);
      if (erpMismatch) {
        setError(erpMismatch);
        reportErpMismatch(erpMismatch);
        updateProgress({ phase: "error", message: erpMismatch });
        return;
      }

      if (!columns.codeColumn || !columns.nameColumn) {
        const message =
          "Could not detect product columns. Expected ID and Name (GloPOS) or ProductCode and ItemName1 (MSP).";
        setError(message);
        updateProgress({ phase: "error", message });
        return;
      }

      const keepColumns = [
        columns.codeColumn,
        columns.nameColumn,
        columns.departmentColumn,
        columns.barcodeColumn,
        columns.retailPriceColumn,
      ].filter((column): column is string => Boolean(column));

      const slimRows = rows.map((row) => {
        const slim: Record<string, string> = {
          __rowNumber: row.__rowNumber ?? "",
        };
        for (const column of keepColumns) {
          slim[column] = row[column] ?? "";
        }
        return slim;
      });

      updateProgress({
        phase: "parsing",
        message: `Found ${slimRows.length.toLocaleString()} products — preparing import…`,
      });

      const begin = await beginProductImportFromRows({
        storeId: Number(selectedStoreId),
        fileName: file.name,
        codeColumn: columns.codeColumn,
        nameColumn: columns.nameColumn,
        departmentColumn: columns.departmentColumn ?? undefined,
        barcodeColumn: columns.barcodeColumn ?? undefined,
        retailPriceColumn: columns.retailPriceColumn ?? undefined,
        shareAcrossMspStores: columns.shareAcrossMspStores,
        rows: slimRows,
      });

      if (!begin.success) {
        setError(begin.error);
        reportErpMismatch(begin.error);
        updateProgress({ phase: "error", message: begin.error });
        return;
      }

      const { jobId, totalRows, batchSize } = begin.data;
      if (totalRows === 0) {
        const message =
          "No valid products found in the file. Check that ID and Name columns are present.";
        setError(message);
        updateProgress({ phase: "error", message });
        return;
      }

      updateProgress({
        phase: "importing",
        estimated: false,
        fileName: file.name,
        storeName,
        total: totalRows,
        processed: 0,
        message: `Saving ${totalRows.toLocaleString()} products…`,
      });

      const batchCount = Math.ceil(totalRows / batchSize);
      let finalResult: ImportResult | null = null;

      for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
        const batch = await runProductImportBatch({ jobId, batchIndex });
        if (!batch.success) {
          setError(batch.error);
          updateProgress({ phase: "error", message: batch.error });
          return;
        }

        finalResult = batch.data.result;
        updateProgress({
          phase: batch.data.done ? "done" : "importing",
          estimated: false,
          processed: batch.data.processed,
          total: batch.data.total,
          result: batch.data.done ? batch.data.result : undefined,
          message: batch.data.done
            ? `Imported ${batch.data.result.matchedRows.toLocaleString()} products.`
            : `Saved ${batch.data.processed.toLocaleString()} of ${batch.data.total.toLocaleString()} products…`,
        });

        if (batch.data.done) break;
      }

      if (!finalResult) {
        const message = "Import finished without a result. Please try again.";
        setError(message);
        updateProgress({ phase: "error", message });
        return;
      }

      setImportResult(finalResult);
      router.push(`/products?storeId=${encodeURIComponent(selectedStoreId)}`);
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : "Import failed unexpectedly";
      setError(message);
      updateProgress({ phase: "error", message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={createMasterProduct} className="space-y-3 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">Create product</h3>
        <div>
          <Label>Name</Label>
          <Input name="name" required />
        </div>
        <div>
          <Label>Department</Label>
          <Input
            name="department"
            required
            placeholder="e.g. Dairy"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Saved as the imported department and used as the initial order
            department. You can change order department later on the product
            list.
          </p>
        </div>
        <div>
          <Label>Store</Label>
          <Select name="storeId" required defaultValue="">
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
          <Label>Store product code</Label>
          <Input name="storeProductCode" required />
        </div>
        <Button type="submit">Create product</Button>
      </form>

      <form
        onSubmit={onImport}
        className="space-y-3 rounded-xl border bg-white p-4"
      >
        <h3 className="font-semibold">Import products from Excel</h3>
        <p className="text-sm text-zinc-600">
          GloPOS exports (Mitcham, Sudbury) use <strong>ID</strong>,{" "}
          <strong>Name</strong>, and <strong>Barcode</strong>. The file is read
          in your browser first, then saved in batches of 2,000. Large catalogs
          (50,000+ products) may take 3–5 minutes to save.
        </p>
        <div>
          <Label>Store</Label>
          <Select
            name="storeId"
            required
            value={storeId}
            onChange={async (e) => {
              const nextStoreId = e.target.value;
              setStoreId(nextStoreId);
              if (importFile && nextStoreId) {
                const valid = await validateSelectedFile(importFile, nextStoreId);
                if (!valid) {
                  setImportFile(null);
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
          <Label>File</Label>
          <FileUploadField
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            onChange={onImportFileChange}
          />
        </div>
        <Button type="submit" disabled={importing}>
          {importing ? "Importing… please wait" : "Import"}
        </Button>
        <ProductImportProgressInline />
        {importResult ? <ImportSummary result={importResult} /> : null}
      </form>

      {error ? <p className="text-sm text-red-600 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
