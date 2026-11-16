"use client";

import { useState, type FormEvent } from "react";
import { AdmOrderForm } from "./adm-order-form";

export function AdmWorkbookImport({ shops, initialDate }: { shops: { id: number; name: string }[]; initialDate: string }) {
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const workbook = new FormData(form).get("workbook");
      if (!(workbook instanceof File) || !/\.xlsx$/i.test(workbook.name) || workbook.size > 8 * 1024 * 1024) {
        throw new Error("Choose an ADM .xlsx workbook up to 8 MB.");
      }
      // Send only the product lists and previous quantities, not the full workbook.
      const { admWorkbookCutoff, parseAdmWorkbook } = await import("@/lib/adm/parse-workbook");
      const catalogs = parseAdmWorkbook(await workbook.arrayBuffer(), admWorkbookCutoff(workbook.name));
      const response = await fetch("/api/adm-order/workbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogs: Object.fromEntries(catalogs) }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      const skipped = result.data.skipped.length ? ` No active shop matched ${result.data.skipped.join(", ")}.` : "";
      setStatus(`Imported ${result.data.imported.join(", ")}.${skipped}`);
      form.reset();
      setRevision((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Workbook import failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <details className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-medium">Import shop lists from Excel</summary>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={upload}>
          <label className="grid gap-1">
            ADM Excel workbook
            <input required name="workbook" type="file" accept=".xlsx" disabled={saving} className="max-w-full rounded border p-2" />
          </label>
          <button type="submit" disabled={saving} className="rounded border px-3 py-2 font-medium disabled:opacity-50">
            {saving ? "Importing…" : "Import workbook"}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
        {status && <p role="status" className="mt-2">{status}</p>}
      </details>
      <AdmOrderForm shops={shops} initialDate={initialDate} catalogRevision={revision} />
    </div>
  );
}
