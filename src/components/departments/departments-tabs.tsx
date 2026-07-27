"use client";

import { useState } from "react";
import { ArrowLeftRight, Layers } from "lucide-react";
import { DepartmentForm } from "@/components/departments/department-form";
import { DepartmentMappingPanel } from "@/components/departments/department-mapping-panel";
import DepartmentList from "@/components/departments/department-list";
import { cn } from "@/utils/cn";
import type {
  Department,
  DepartmentMapping,
  ImportedDepartmentStat,
} from "@/types/department";

const tabs = [
  {
    id: "list" as const,
    label: "Order departments",
    icon: Layers,
    description: "Create bakery, dairy, etc.",
  },
  {
    id: "mapping" as const,
    label: "Map imported",
    icon: ArrowLeftRight,
    description: "Group ERP labels → order departments",
  },
];

export function DepartmentsTabs({
  departments,
  mappings,
  importedDepartments,
}: {
  departments: Department[];
  mappings: DepartmentMapping[];
  importedDepartments: ImportedDepartmentStat[];
}) {
  const unmappedCount = importedDepartments.filter(
    (row) => row.orderDepartmentId == null,
  ).length;
  const [active, setActive] = useState<"list" | "mapping">(
    unmappedCount > 0 ? "mapping" : "list",
  );

  return (
    <div className="space-y-6">
      <nav
        className="grid gap-3 sm:grid-cols-2"
        aria-label="Department sections"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "rounded-xl border p-4 text-left transition",
                isActive
                  ? "border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-200"
                  : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "rounded-lg p-2",
                    isActive
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-100 text-zinc-600",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <p
                    className={cn(
                      "font-semibold",
                      isActive ? "text-emerald-900" : "text-zinc-900",
                    )}
                  >
                    {tab.label}
                    {tab.id === "mapping" && unmappedCount > 0 ? (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {unmappedCount} unmapped
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-600">{tab.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {active === "list" ? (
        <div className="space-y-8">
          <DepartmentForm />
          <DepartmentList departments={departments} />
        </div>
      ) : (
        <div className="space-y-4">
          {unmappedCount > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>{unmappedCount.toLocaleString()}</strong> imported department
              {unmappedCount === 1 ? "" : "s"} still need mapping. Example: map{" "}
              <span className="font-medium">TWELVE GRAINS</span> →{" "}
              <span className="font-medium">BAKERY</span>, then click{" "}
              <span className="font-medium">Apply all to products</span>.
            </div>
          ) : null}
          <DepartmentMappingPanel
            departments={departments}
            mappings={mappings}
            importedDepartments={importedDepartments}
          />
        </div>
      )}
    </div>
  );
}
