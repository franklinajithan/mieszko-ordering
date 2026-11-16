"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AdmWorkbookImport() {
  const router = useRouter();
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
      const response = await fetch("/api/adm-order/workbook", { method: "POST", body: new FormData(form) });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      const skipped = result.data.skipped.length ? ` No active shop matched ${result.data.skipped.join(", ")}.` : "";
      setStatus(`Imported ${result.data.imported.join(", ")}.${skipped}`);
      form.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Workbook import failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Import ADM workbook</summary>
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
  );
}
