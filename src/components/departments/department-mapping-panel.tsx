"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import {
  applyDepartmentMappings,
  deleteDepartmentMapping,
  upsertDepartmentMapping,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import type {
  Department,
  DepartmentMapping,
  ImportedDepartmentStat,
} from "@/types/department";

export function DepartmentMappingPanel({
  departments,
  mappings,
  importedDepartments,
}: {
  departments: Department[];
  mappings: DepartmentMapping[];
  importedDepartments: ImportedDepartmentStat[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.isActive),
    [departments],
  );

  const unmapped = importedDepartments.filter(
    (row) => row.orderDepartmentId == null,
  );

  function draftValue(importedDepartment: string, currentId: number | null) {
    const draft = drafts[importedDepartment];
    if (draft !== undefined) return draft;
    return currentId != null ? String(currentId) : "";
  }

  function saveMapping(importedDepartment: string) {
    const value = draftValue(
      importedDepartment,
      importedDepartments.find((row) => row.importedDepartment === importedDepartment)
        ?.orderDepartmentId ?? null,
    );
    if (!value) {
      setError("Choose an order department");
      return;
    }

    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await upsertDepartmentMapping({
        importedDepartment,
        orderDepartmentId: Number(value),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[importedDepartment];
        return next;
      });
      setMessage(
        `Mapped “${importedDepartment}” and updated ${result.data.productsUpdated.toLocaleString()} product(s).`,
      );
      router.refresh();
    });
  }

  function removeMapping(id: number) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await deleteDepartmentMapping(id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function applyAll() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await applyDepartmentMappings();
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMessage(
        `Updated order department on ${result.data.updated.toLocaleString()} products using ${result.data.mappings} mapping(s).`,
      );
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-zinc-900">Imported department mapping</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Map ERP/import department labels (e.g. TWELVE GRAINS) to your order
            departments (e.g. BAKERY). Saving a mapping updates matching products
            immediately. Use Apply all for mappings saved earlier.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pending || mappings.length === 0}
          onClick={applyAll}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
          Apply all to products
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {mappings.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Imported department</th>
                <th className="px-3 py-2">Order department</th>
                <th className="px-3 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td className="px-3 py-2 font-medium text-zinc-800">
                    {mapping.importedDepartment}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {mapping.orderDepartmentName}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => removeMapping(mapping.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {importedDepartments.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No imported departments yet. Import products first to see ERP department
          labels here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Imported department</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">Maps to order department</th>
                <th className="px-3 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {importedDepartments.map((row) => (
                <tr
                  key={row.importedDepartment}
                  className={row.orderDepartmentId == null ? "bg-amber-50/40" : undefined}
                >
                  <td className="px-3 py-2 font-medium text-zinc-800">
                    {row.importedDepartment}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">
                    {row.productCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                      <Select
                        value={draftValue(row.importedDepartment, row.orderDepartmentId)}
                        disabled={pending || activeDepartments.length === 0}
                        className="h-9 min-w-[12rem]"
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.importedDepartment]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Choose order department…</option>
                        {activeDepartments.map((department) => (
                          <option key={department.id} value={String(department.id)}>
                            {department.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => saveMapping(row.importedDepartment)}
                    >
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unmapped.length > 0 ? (
        <p className="text-xs text-amber-800">
          {unmapped.length.toLocaleString()} imported department
          {unmapped.length === 1 ? "" : "s"} still unmapped. Save a mapping to
          assign order department on matching products automatically.
        </p>
      ) : null}
    </section>
  );
}
