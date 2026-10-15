"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  importSupplierCodeChunk,
  parseSupplierCodeFile,
  SUPPLIER_CODES_IMPORT_CHUNK_SIZE,
  type SupplierCodeImportResult,
} from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SupplierCodeConflict,
  SupplierCodePreviewState,
} from "@/components/supplier-codes/types";
import { parseSupplierCodeFileBuffer } from "@/parsers/supplier-codes/supplier-code-file-parser";
import {
  expandSupplierCodeAssignments,
  findInFileSupplierCodeConflicts,
} from "@/services/supplier-codes/supplier-code-import-prepare";
import {
  detectBookStockFileErpType,
  reportErpMismatch,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import { checkUploadErpMismatch } from "@/utils/validate-upload-erp";

type Store = { id: number; name: string; code: string; erpType: string };

const CONFLICT_WARNING_STORAGE_KEY = "supplier-codes-duplicate-warning";

type StoredDuplicateWarning = {
  storeId: number;
  storeName: string;
  fileName: string;
  conflicts: SupplierCodeConflict[];
  conflictCount: number;
  uniqueCodeCount: number;
};

function chunkRows<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}

function detectSupplierCodeFileErp(
  headers: string[],
  fileName: string,
): "msp" | "glopos" | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const hasProductCode = lower.some(
    (h) => h === "productcode" || h === "product code",
  );
  const hasId = lower.some((h) => h === "id");
  const hasMm = lower.some((h) => h.includes("mm code") || h === "mmcode");
  if (hasProductCode && hasMm) return "msp";
  if (hasId && hasMm && !hasProductCode) return "glopos";
  return detectBookStockFileErpType(headers, fileName);
}

/** Same supplier code mapped to 2+ store product codes in one upload. */
function isMultiStoreProductConflict(conflict: SupplierCodeConflict): boolean {
  return /multiple store products/i.test(conflict.reason);
}

function summarizeDuplicateConflicts(conflicts: SupplierCodeConflict[]) {
  const multi = conflicts.filter(isMultiStoreProductConflict);
  const uniqueCodes = new Set(
    multi.map(
      (c) =>
        `${c.supplierKey}|${c.supplierCode.normalize("NFC").toLocaleLowerCase("pl-PL")}`,
    ),
  );
  return {
    conflicts: multi,
    conflictCount: multi.length,
    uniqueCodeCount: uniqueCodes.size,
  };
}

function readStoredWarning(): StoredDuplicateWarning | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CONFLICT_WARNING_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDuplicateWarning;
  } catch {
    return null;
  }
}

function writeStoredWarning(warning: StoredDuplicateWarning | null) {
  if (typeof window === "undefined") return;
  if (!warning || warning.conflictCount === 0) {
    sessionStorage.removeItem(CONFLICT_WARNING_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(CONFLICT_WARNING_STORAGE_KEY, JSON.stringify(warning));
}

function DuplicateSupplierCodeWarning({
  storeName,
  fileName,
  conflictCount,
  uniqueCodeCount,
  conflicts,
  onDismiss,
}: {
  storeName: string;
  fileName?: string;
  conflictCount: number;
  uniqueCodeCount: number;
  conflicts: SupplierCodeConflict[];
  onDismiss?: () => void;
}) {
  if (!conflictCount) return null;
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-amber-400 bg-amber-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-amber-950">
            Duplicate supplier codes in {storeName}
          </p>
          <p className="text-sm text-amber-900">
            {uniqueCodeCount.toLocaleString()} supplier code
            {uniqueCodeCount === 1 ? "" : "s"} map to multiple store product
            codes in this store
            {fileName ? ` (${fileName})` : ""}.{" "}
            {conflictCount.toLocaleString()} assignment
            {conflictCount === 1 ? "" : "s"} share a supplier code. The code
            is applied to every listed product so one supplier price can update
            them all. Review on{" "}
            <Link href="/products" className="font-medium underline">
              Products
            </Link>{" "}
            and re-upload if needed.
          </p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-sm font-medium text-amber-800 underline"
          >
            Dismiss
          </button>
        ) : null}
      </div>
      <ConflictTable conflicts={conflicts} compact />
    </div>
  );
}

function ConflictTable({
  conflicts,
  compact = false,
}: {
  conflicts: SupplierCodeConflict[];
  compact?: boolean;
}) {
  if (!conflicts.length) return null;
  return (
    <div
      className={
        compact
          ? "space-y-2"
          : "space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4"
      }
    >
      {!compact ? (
        <>
          <h4 className="font-semibold text-amber-950">
            Shared supplier codes ({conflicts.length.toLocaleString()})
          </h4>
          <p className="text-sm text-amber-900">
            These are imported for every listed product. Review them on the{" "}
            <Link href="/products" className="font-medium underline">
              Products
            </Link>{" "}
            page, then re-upload if needed.
          </p>
        </>
      ) : null}
      <div className="max-h-72 overflow-auto rounded-lg border border-amber-200 bg-white/70">
        <table className="min-w-full text-sm">
          <thead className="bg-amber-100/80 text-left">
            <tr>
              <th className="px-2 py-1.5">Row</th>
              <th className="px-2 py-1.5">Store code</th>
              <th className="px-2 py-1.5">Supplier</th>
              <th className="px-2 py-1.5">Supplier code</th>
              <th className="px-2 py-1.5">Reason</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict, index) => (
              <tr
                key={`${conflict.rowNumber}-${conflict.supplierKey}-${conflict.supplierCode}-${index}`}
                className="border-t border-amber-200"
              >
                <td className="px-2 py-1.5 tabular-nums">{conflict.rowNumber}</td>
                <td className="px-2 py-1.5 font-medium">
                  {conflict.storeProductCode}
                </td>
                <td className="px-2 py-1.5">{conflict.supplierKey}</td>
                <td className="px-2 py-1.5">{conflict.supplierCode}</td>
                <td className="px-2 py-1.5 text-amber-950">
                  {conflict.reason}
                  {conflict.otherStoreCodes?.length
                    ? ` (also: ${conflict.otherStoreCodes.join(", ")})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SupplierCodeImportForm({ stores }: { stores: Store[] }) {
  const [preview, setPreview] = useState<SupplierCodePreviewState | null>(null);
  const [result, setResult] = useState<SupplierCodeImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [storeId, setStoreId] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    fileName: string;
    storeName: string;
    done: boolean;
  } | null>(null);
  const [storedWarning, setStoredWarning] =
    useState<StoredDuplicateWarning | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => String(store.id) === storeId) ?? null,
    [stores, storeId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser-local storage after server rendering.
    setStoredWarning(readStoredWarning());
  }, []);

  const liveDuplicateSummary = useMemo(() => {
    const conflicts = result?.conflicts ?? preview?.conflicts ?? [];
    return summarizeDuplicateConflicts(conflicts);
  }, [result, preview]);

  const activeWarning = useMemo(() => {
    if (warningDismissed) return null;
    if (liveDuplicateSummary.conflictCount > 0 && selectedStore) {
      const fromResult = result?.duplicateRows ?? 0;
      const fromPreview = preview?.conflictCount ?? 0;
      return {
        storeId: selectedStore.id,
        storeName: selectedStore.name,
        fileName: file?.name ?? "",
        conflicts: liveDuplicateSummary.conflicts.slice(0, 200),
        conflictCount: Math.max(
          fromResult,
          fromPreview,
          liveDuplicateSummary.conflictCount,
        ),
        uniqueCodeCount: liveDuplicateSummary.uniqueCodeCount,
      } satisfies StoredDuplicateWarning;
    }
    if (storedWarning && storeId && String(storedWarning.storeId) === storeId) {
      return storedWarning;
    }
    return null;
  }, [
    warningDismissed,
    liveDuplicateSummary,
    selectedStore,
    file?.name,
    result?.duplicateRows,
    preview?.conflictCount,
    storedWarning,
    storeId,
  ]);

  async function validateSelectedFile(selected: File | null) {
    if (!selected || !storeId) return true;
    const mismatch = await checkUploadErpMismatch(
      selected,
      resolveStoreErpType(selectedStore?.erpType),
      detectSupplierCodeFileErp,
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
    setWarningDismissed(false);
    try {
      if (!storeId) {
        setError("Select a store before previewing the file.");
        return;
      }
      const selected = formData.get("file") as File;
      if (!(selected instanceof File) || selected.size === 0) {
        setError("Choose an Excel file to preview.");
        return;
      }
      if (!(await validateSelectedFile(selected))) {
        return;
      }
      setFile(selected);
      formData.set("storeId", storeId);
      const data = await parseSupplierCodeFile(formData);
      setPreview(data);
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
    setResult(null);
    setWarningDismissed(false);
    setImporting(true);
    setProgress(null);
    try {
      const storeName = selectedStore?.name ?? "";
      const parsed = await parseSupplierCodeFileBuffer(
        await file.arrayBuffer(),
        file.name,
      );
      const assignments = expandSupplierCodeAssignments(parsed.rows);
      const { clean, conflicts: inFileConflicts } =
        findInFileSupplierCodeConflicts(assignments);

      if (!clean.length && !inFileConflicts.length) {
        setError("No supplier codes found in the file.");
        return;
      }

      const batches = chunkRows(clean, SUPPLIER_CODES_IMPORT_CHUNK_SIZE);
      const aggregated: SupplierCodeImportResult = {
        totalRows: assignments.length,
        matchedRows: 0,
        unmatchedRows: 0,
        invalidRows: 0,
        duplicateRows: inFileConflicts.length,
        errors: [],
        created: 0,
        updated: 0,
        unchanged: 0,
        markedUnavailable: 0,
        conflicts: [...inFileConflicts],
        unmatchedCodes: [],
      };

      let processed = 0;
      const totalRows = clean.length;
      setProgress({
        processed: 0,
        total: totalRows,
        fileName: file.name,
        storeName,
        done: false,
      });

      for (const batch of batches) {
        const chunk = await importSupplierCodeChunk({
          storeId: Number(storeId),
          erpType: parsed.erpType,
          fileName: file.name,
          assignments: batch,
        });
        if (!chunk.success) {
          setError(chunk.error);
          reportErpMismatch(chunk.error);
          setProgress(null);
          return;
        }
        aggregated.matchedRows += chunk.data.matchedRows;
        aggregated.unmatchedRows += chunk.data.unmatchedRows;
        aggregated.invalidRows += chunk.data.invalidRows;
        aggregated.created += chunk.data.created;
        aggregated.updated += chunk.data.updated;
        aggregated.unchanged += chunk.data.unchanged;
        aggregated.markedUnavailable += chunk.data.markedUnavailable;
        aggregated.errors.push(...chunk.data.errors);
        aggregated.conflicts.push(...chunk.data.conflicts);
        for (const code of chunk.data.unmatchedCodes) {
          if (!aggregated.unmatchedCodes.includes(code)) {
            aggregated.unmatchedCodes.push(code);
          }
        }
        processed += batch.length;
        setProgress({
          processed,
          total: totalRows,
          fileName: file.name,
          storeName,
          done: processed >= totalRows,
        });
      }

      aggregated.conflicts = aggregated.conflicts.slice(0, 200);
      aggregated.unmatchedCodes = aggregated.unmatchedCodes.slice(0, 100);
      aggregated.errors = aggregated.errors.slice(0, 50);

      const duplicateSummary = summarizeDuplicateConflicts(aggregated.conflicts);
      const warning: StoredDuplicateWarning | null =
        duplicateSummary.conflictCount > 0
          ? {
              storeId: Number(storeId),
              storeName,
              fileName: file.name,
              conflicts: duplicateSummary.conflicts.slice(0, 200),
              conflictCount: Math.max(
                aggregated.duplicateRows ?? 0,
                duplicateSummary.conflictCount,
              ),
              uniqueCodeCount: duplicateSummary.uniqueCodeCount,
            }
          : null;
      writeStoredWarning(warning);
      setStoredWarning(warning);

      setResult(aggregated);
      setPreview(null);
      setProgress(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      setError(message);
      reportErpMismatch(message);
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }

  const progressPercent = progress
    ? Math.round((progress.processed / Math.max(1, progress.total)) * 100)
    : 0;

  const resultDuplicateCount = result
    ? Math.max(
        result.duplicateRows ?? 0,
        summarizeDuplicateConflicts(result.conflicts).conflictCount,
      )
    : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Upload HO supplier-code files: MSP uses <strong>ProductCode</strong> +
        MM/SP/WAB; GloPOS uses <strong>ID</strong> + MM/SP/WAB. WAB codes keep
        Polish UTF-8 characters (ł, ę, ó, …). Blank cells mean not finalized yet
        (skipped). Markers like “Not in MM / SP / WAB” are stored as confirmed
        unavailable. Shared supplier codes across different store products are
        highlighted and imported for each product.
      </p>

      {activeWarning ? (
        <DuplicateSupplierCodeWarning
          storeName={activeWarning.storeName}
          fileName={activeWarning.fileName}
          conflictCount={activeWarning.conflictCount}
          uniqueCodeCount={activeWarning.uniqueCodeCount}
          conflicts={activeWarning.conflicts}
          onDismiss={() => {
            writeStoredWarning(null);
            setStoredWarning(null);
            setWarningDismissed(true);
          }}
        />
      ) : null}

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
                setResult(null);
                setWarningDismissed(false);
                if (file && nextStoreId) {
                  const nextStore = stores.find(
                    (store) => String(store.id) === nextStoreId,
                  );
                  const mismatch = await checkUploadErpMismatch(
                    file,
                    resolveStoreErpType(nextStore?.erpType),
                    detectSupplierCodeFileErp,
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
            <Label>Excel file</Label>
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
                  ? "Supplier codes import complete"
                  : "Saving supplier codes…"}
              </p>
              <p className="text-sm text-zinc-600">
                {progress.fileName} · {progress.storeName}
              </p>
              <div
                className="h-3 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
                aria-label="Supplier codes import progress"
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
                {progress.total.toLocaleString()} assignments ·{" "}
                {progressPercent}%
              </p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-zinc-900">Import result</h3>
              {resultDuplicateCount > 0 ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                  Warning: duplicate supplier codes against multiple store
                  product codes were imported for every matching product (
                  {resultDuplicateCount.toLocaleString()} shared assignments).
                  See the flag above for details.
                </p>
              ) : null}
              <ImportSummary result={result} />
              <ul className="space-y-1 text-sm text-zinc-700">
                <li>Created: {result.created.toLocaleString()}</li>
                <li>Updated: {result.updated.toLocaleString()}</li>
                <li>Unchanged: {result.unchanged.toLocaleString()}</li>
                <li>
                  Marked unavailable:{" "}
                  {result.markedUnavailable.toLocaleString()}
                </li>
                <li>
                  Shared supplier-code assignments:{" "}
                  {(result.duplicateRows ?? 0).toLocaleString()}
                </li>
              </ul>
              {result.unmatchedCodes.length ? (
                <p className="text-sm text-zinc-600">
                  Unmatched store codes (sample):{" "}
                  {result.unmatchedCodes.slice(0, 20).join(", ")}
                  {result.unmatchedCodes.length > 20 ? "…" : ""}
                </p>
              ) : null}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-zinc-900">Ready to import</h3>
              <ul className="space-y-1 text-sm text-zinc-700">
                <li>
                  Format:{" "}
                  {preview.erpType === "glopos"
                    ? "GloPOS (ID)"
                    : "MSP (ProductCode)"}
                </li>
                <li>File rows: {preview.totalRows.toLocaleString()}</li>
                <li>
                  Supplier assignments:{" "}
                  {preview.assignmentCount.toLocaleString()}
                </li>
                <li>
                  Matched store products:{" "}
                  {preview.matchedStoreCodes.toLocaleString()}
                </li>
                <li>
                  Unmatched store codes:{" "}
                  {preview.unmatchedStoreCodes.toLocaleString()}
                </li>
                <li>
                  Conflicts:{" "}
                  <span
                    className={
                      preview.conflictCount
                        ? "font-semibold text-amber-800"
                        : undefined
                    }
                  >
                    {preview.conflictCount.toLocaleString()}
                  </span>
                </li>
              </ul>
              <Button
                type="button"
                disabled={importing}
                onClick={() => void onImport()}
              >
                {importing ? "Importing…" : "Import supplier codes"}
              </Button>
            </div>
          ) : (
            <div className="flex h-full min-h-40 flex-col justify-center text-sm text-zinc-500">
              <p className="font-medium text-zinc-700">Import result</p>
              <p className="mt-1">
                Preview a file to see matches and conflicts, then import clean
                rows.
              </p>
            </div>
          )}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
