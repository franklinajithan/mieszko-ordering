"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importDepartments, previewUpload } from "@/lib/api";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectDepartmentColumns } from "@/parsers/file-parser";
import type { FilePreview, ImportResult } from "@/types";

export function DepartmentImportForm() {
  const router = useRouter();
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [nameColumn, setNameColumn] = useState("");
  const [codeColumn, setCodeColumn] = useState("");

  async function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    try {
      const selected = formData.get("file") as File;
      setFile(selected);
      const data = await previewUpload(formData);
      setPreview(data);
      const detected = detectDepartmentColumns(data.headers);
      setNameColumn(detected.nameColumn ?? data.headers[0] ?? "");
      setCodeColumn(detected.codeColumn ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  async function onImport() {
    if (!file || !nameColumn) {
      setError("Select a file and name column first");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("nameColumn", nameColumn);
    if (codeColumn) formData.set("codeColumn", codeColumn);

    const response = await importDepartments(formData);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setResult(response.data);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Import departments from Excel</h3>
      <p className="text-sm text-zinc-600">
        Upload a spreadsheet with department names. Existing departments are
        matched by name; new rows are created automatically.
      </p>

      <form action={onPreview} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>File</Label>
          <FileUploadField name="file" accept=".csv,.xlsx,.xls" required />
        </div>
        <Button type="submit" variant="outline">
          Preview columns
        </Button>
      </form>

      {preview ? (
        <div className="space-y-4 border-t pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Name column</Label>
              <Select
                value={nameColumn}
                onChange={(e) => setNameColumn(e.target.value)}
              >
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Code column (optional)</Label>
              <Select
                value={codeColumn}
                onChange={(e) => setCodeColumn(e.target.value)}
              >
                <option value="">None</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {preview.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-50 text-left">
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className="px-3 py-2">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row, index) => (
                    <tr key={index}>
                      {preview.headers.map((header) => (
                        <td key={header} className="px-3 py-2">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <Button onClick={onImport}>Import departments</Button>
        </div>
      ) : null}

      {result ? <ImportSummary result={result} /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
