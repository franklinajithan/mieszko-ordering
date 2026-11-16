"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type { ReviewRow } from "@/services/reconciliation/workbook";
type Item = {
  id: string;
  storeId: number;
  store: string;
  kind: string;
  identifier: string;
  productName: string;
  status: string;
  lastCheckedAt: string;
  jobs: string;
  dates: string;
  feeds: string;
  transactionCount: number | null;
};
type Listing = {
  items: Item[];
  total: number;
  stores: { id: number; name: string }[];
  checkedAt: string | null;
  page: number;
  pageSize: number;
};
type Preview = {
  id: string;
  rows: ReviewRow[];
  summary: { total: number; changes: number; pending: number; errors: number };
  page: number;
};
type Audit = {
  id: string;
  action: string;
  operatorName: string;
  notes: string;
  createdAt: string;
  productCode: string;
  supplierCode: string;
};
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok || !body.success)
    throw new Error(body.error || "Request failed.");
  return body.data;
}
const button =
  "rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40";
const input = "rounded-md border bg-background p-2 text-sm";
export function UnmatchedProducts() {
  const [filters, setFilters] = useState({
    storeId: "",
    kind: "",
    feed: "",
    status: "pending",
    search: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operator, setOperator] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [auditLabel, setAuditLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const query = new URLSearchParams({
    ...filters,
    page: String(page),
  }).toString();
  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const data = await request<Listing>("/api/unmatched-products?" + query);
      if (id === sequence.current) setListing(data);
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Could not load products.");
    }
  }, [query]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ queued: number }>(
        "/api/unmatched-products",
        { method: "POST" },
      );
      await load();
      setMessage(
        `Product master checked. ${data.queued} eligible reports queued.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setConfirmed(false);
    try {
      const form = new FormData();
      form.set("file", file);
      setPreview(
        await request<Preview>("/api/unmatched-products/preview", {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ applied: number; queued: number }>(
        "/api/unmatched-products/approve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: preview.id,
            operator,
            confirm: confirmed,
          }),
        },
      );
      setMessage(
        `${result.applied} corrections approved. ${result.queued} eligible reports queued. Matching rows are saved on eligible retries; remaining unmatched rows stay pending.`,
      );
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }
  async function previewPage(next: number) {
    if (!preview) return;
    setBusy(true);
    try {
      setPreview(
        await request<Preview>(
          `/api/unmatched-products?batchId=${preview.id}&page=${next}`,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function filter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Product reconciliation</h2>
            <p className="text-sm text-muted-foreground">
              {listing?.total ?? "—"} identifiers in this view · Last refresh:{" "}
              {listing?.checkedAt
                ? new Date(listing.checkedAt).toLocaleString()
                : "Not yet checked"}
            </p>
          </div>
          <button className={button} onClick={refresh} disabled={busy}>
            Refresh
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Refresh first to collect all product failures and check the latest
          product master. Matching rows for new reports are saved immediately; unmatched rows stay pending. Earlier complete imports are protected. Parsing errors stay in Download Queue. Unknown
          transaction counts from older jobs are shown as unavailable.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            className={button + " bg-emerald-700 text-white"}
            href={"/api/unmatched-products/export?" + query}
          >
            Download Excel
          </a>
          <button
            className={button}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload Corrected Excel
          </button>
          <Link className={button} href="/products">
            Product Upload
          </Link>
          <Link className={button} href="/downloads">
            Download Queue
          </Link>
        </div>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept=".xlsx"
          aria-label="Corrected Excel file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {busy && (
        <p role="status">
          Processing… Please wait for validation and database operations to
          finish.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-400 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md border border-emerald-500 p-3">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          className={input}
          aria-label="Resolution status"
          value={filters.status}
          onChange={(e) => filter("status", e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <select
          className={input}
          aria-label="Store"
          value={filters.storeId}
          onChange={(e) => filter("storeId", e.target.value)}
        >
          <option value="">All stores</option>
          {listing?.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <select
          className={input}
          aria-label="Identifier type"
          value={filters.kind}
          onChange={(e) => filter("kind", e.target.value)}
        >
          <option value="">All identifiers</option>
          <option>Barcode</option>
          <option>Product code</option>
        </select>
        <select
          className={input}
          aria-label="Report type"
          value={filters.feed}
          onChange={(e) => filter("feed", e.target.value)}
        >
          <option value="">All reports</option>
          <option value="normal_sales">Normal sales</option>
          <option value="rtc">RTC</option>
          <option value="wastage">Wastage</option>
        </select>
        <input
          className={input}
          aria-label="Search identifiers"
          placeholder="Search identifier or product"
          value={filters.search}
          onChange={(e) => filter("search", e.target.value)}
        />
        <label className="text-sm">
          From{" "}
          <input
            className={input}
            type="date"
            value={filters.from}
            onChange={(e) => filter("from", e.target.value)}
          />
        </label>
        <label className="text-sm">
          To{" "}
          <input
            className={input}
            type="date"
            value={filters.to}
            onChange={(e) => filter("to", e.target.value)}
          />
        </label>
      </div>
      <div className="overflow-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              {[
                "Store",
                "Identifier / type",
                "Product",
                "Reports / dates",
                "Affected jobs",
                "Transactions",
                "Status / checked",
                "Review",
              ].map((title) => (
                <th className="p-3" key={title}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listing?.items.map((item) => (
              <tr className="border-t align-top" key={item.id}>
                <td className="p-3">{item.store}</td>
                <td className="p-3">
                  <span className="font-mono">{item.identifier}</span>
                  <div className="text-muted-foreground">{item.kind}</div>
                </td>
                <td className="p-3">{item.productName || "Details needed"}</td>
                <td className="p-3 max-w-60">
                  <div className="break-words">{item.feeds}</div>
                  <div>{item.dates}</div>
                </td>
                <td className="p-3 max-w-40 break-words">{item.jobs}</td>
                <td className="p-3">
                  {item.transactionCount ?? "Unavailable"}
                </td>
                <td className="p-3">
                  {item.status}
                  <div className="text-xs">
                    {new Date(item.lastCheckedAt).toLocaleString()}
                  </div>
                </td>
                <td className="p-3">
                  <button
                    className={button}
                    onClick={async () => {
                      setAuditLabel(item.identifier);
                      try {
                        setAudit(
                          await request<Audit[]>(
                            "/api/unmatched-products?audit=" + item.id,
                          ),
                        );
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Audit History
                  </button>
                </td>
              </tr>
            ))}
            {!listing?.items.length && (
              <tr>
                <td colSpan={8} className="p-5">
                  No identifiers in this view. Use Refresh to check the latest
                  product master and import failures.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          className={button}
          disabled={page <= 1 || busy}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil((listing?.total ?? 0) / 50))}
        </span>
        <button
          className={button}
          disabled={page * 50 >= (listing?.total ?? 0) || busy}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      {preview && (
        <section
          className="rounded-xl border p-4 space-y-3"
          aria-label="Preview Changes"
        >
          <h2 className="text-lg font-semibold">Preview Changes</h2>
          <a
            className={button + " inline-block"}
            href={
              "/api/unmatched-products/preview/export?batchId=" + preview.id
            }
          >
            Download Validation Results
          </a>
          <p>
            {preview.summary.changes} proposed updates ·{" "}
            {preview.summary.pending} pending rows · {preview.summary.errors}{" "}
            rows with validation errors
          </p>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {[
                    "Row",
                    "Identifier",
                    "Action / target",
                    "Validation Errors / warnings",
                  ].map((t) => (
                    <th key={t} className="p-2 text-left">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t">
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="p-2">{row.identifier}</td>
                    <td className="p-2">
                      {row.action || "Pending"}{" "}
                      {row.existingCode || row.newCode}
                    </td>
                    <td className="p-2">
                      {row.errors.map((error, i) => (
                        <div className="text-red-700" key={i}>
                          {error}
                        </div>
                      ))}
                      {row.warnings.map((warning, i) => (
                        <div key={i}>{warning}</div>
                      ))}
                      {!row.errors.length && !row.warnings.length && "Valid"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              className={button}
              disabled={preview.page <= 1 || busy}
              onClick={() => previewPage(preview.page - 1)}
            >
              Previous preview
            </button>
            <span>
              Page {preview.page} of {Math.ceil(preview.summary.total / 50)}
            </span>
            <button
              className={button}
              disabled={preview.page * 50 >= preview.summary.total || busy}
              onClick={() => previewPage(preview.page + 1)}
            >
              Next preview
            </button>
          </div>
          <label className="block text-sm">
            Operator name (self-reported)
            <input
              className={input + " ml-2"}
              value={operator}
              maxLength={100}
              onChange={(e) => setOperator(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have reviewed these mappings and approve the proposed database
            updates.
          </label>
          <div className="flex gap-2">
            <button
              className={button + " bg-emerald-700 text-white"}
              disabled={
                busy ||
                !!preview.summary.errors ||
                !preview.summary.changes ||
                !operator.trim() ||
                !confirmed
              }
              onClick={approve}
            >
              Approve Updates
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel preview
            </button>
          </div>
        </section>
      )}
      {audit && (
        <section
          className="rounded-xl border p-4 space-y-2"
          aria-label="Audit History"
        >
          <h2 className="font-semibold">Audit History · {auditLabel}</h2>
          {audit.length ? (
            audit.map((row) => (
              <p className="text-sm" key={row.id}>
                {new Date(row.createdAt).toLocaleString()} · {row.action} ·{" "}
                {row.operatorName} · {row.productCode} {row.notes}{" "}
                {row.supplierCode && `Supplier reference: ${row.supplierCode}`}
              </p>
            ))
          ) : (
            <p>No approvals recorded.</p>
          )}
          <button className={button} onClick={() => setAudit(null)}>
            Close history
          </button>
        </section>
      )}
    </div>
  );
}
