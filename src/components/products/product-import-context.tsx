"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ImportResult } from "@/types";
import type {
  ProductImportPhase,
  ProductImportStatus,
} from "@/types/product";

type ProductImportContextValue = {
  status: ProductImportStatus;
  setStatus: (status: ProductImportStatus) => void;
  resetStatus: () => void;
  updateProgress: (update: Partial<ProductImportStatus>) => void;
};

const idleStatus: ProductImportStatus = {
  phase: "idle",
  processed: 0,
  total: 0,
};

const ProductImportContext = createContext<ProductImportContextValue | null>(null);

export function ProductImportProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ProductImportStatus>(idleStatus);

  const resetStatus = useCallback(() => {
    setStatus(idleStatus);
  }, []);

  const updateProgress = useCallback((update: Partial<ProductImportStatus>) => {
    setStatus((current) => ({ ...current, ...update }));
  }, []);

  const value = useMemo(
    () => ({ status, setStatus, resetStatus, updateProgress }),
    [status, resetStatus, updateProgress],
  );

  return (
    <ProductImportContext.Provider value={value}>
      {children}
    </ProductImportContext.Provider>
  );
}

export function useProductImport() {
  const context = useContext(ProductImportContext);
  if (!context) {
    throw new Error("useProductImport must be used within ProductImportProvider");
  }
  return context;
}

const PHASE_LABELS: Record<ProductImportPhase, string> = {
  idle: "Ready",
  parsing: "Reading Excel file…",
  importing: "Saving products…",
  done: "Import complete",
  error: "Import failed",
};

function importProgressPercent(status: ProductImportStatus): number {
  if (status.phase === "done") return 100;
  if (status.estimated) return Math.min(98, status.processed);
  if (status.total > 0) {
    return Math.min(100, Math.round((status.processed / status.total) * 100));
  }
  if (status.phase === "parsing") return 12;
  return 45;
}

function progressBarClass(status: ProductImportStatus): string {
  if (status.phase === "error") return "bg-red-500";
  if (status.phase === "done") return "bg-emerald-500";
  if (status.estimated) {
    return "animate-pulse bg-emerald-600";
  }
  return "bg-emerald-600";
}

export function ProductImportProgressInline() {
  const { status } = useProductImport();
  if (status.phase === "idle") return null;

  const progress = importProgressPercent(status);

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-zinc-800">
          {PHASE_LABELS[status.phase]}
        </span>
        <span className="tabular-nums text-zinc-500">
          {status.estimated && status.phase !== "done" ? "~" : ""}
          {progress}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-200">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${progressBarClass(status)}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {status.message ? (
        <p className="text-xs text-zinc-600">{status.message}</p>
      ) : null}
      {status.estimated && status.phase !== "done" && status.phase !== "error" ? (
        <p className="text-xs text-zinc-500">
          Progress is estimated — large imports (5000+ products) can take 3–5 minutes.
        </p>
      ) : null}
    </div>
  );
}

export function ProductImportStatusBar() {
  const { status } = useProductImport();

  if (status.phase === "idle") return null;

  const progress = importProgressPercent(status);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-zinc-900">{PHASE_LABELS[status.phase]}</p>
          {status.fileName ? (
            <p className="text-sm text-zinc-600">
              {status.fileName}
              {status.storeName ? ` · ${status.storeName}` : null}
            </p>
          ) : null}
          {status.message ? (
            <p className="text-sm text-zinc-600">{status.message}</p>
          ) : null}
        </div>
        <span className="text-sm tabular-nums text-zinc-500">
          {status.estimated && status.phase !== "done" ? "~" : ""}
          {progress}%
        </span>
      </div>

      <div
        className="h-3 overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Product import progress"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${progressBarClass(status)}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {status.estimated && status.phase !== "done" && status.phase !== "error" ? (
        <p className="text-xs text-zinc-500">
          Still working — this is not stuck. Large GloPOS exports can take several minutes.
        </p>
      ) : null}

      {!status.estimated && status.total > 0 && status.phase === "importing" ? (
        <p className="text-xs text-zinc-600">
          Saved {status.processed.toLocaleString()} of {status.total.toLocaleString()} products
        </p>
      ) : null}

      {status.phase === "done" && status.result ? (
        <p className="text-sm text-emerald-800">
          Imported {status.result.matchedRows.toLocaleString()} products
          {status.result.duplicateRows
            ? ` · ${status.result.duplicateRows.toLocaleString()} updated/skipped duplicates`
            : null}
          {status.result.invalidRows
            ? ` · ${status.result.invalidRows.toLocaleString()} invalid rows`
            : null}
        </p>
      ) : null}
    </div>
  );
}
