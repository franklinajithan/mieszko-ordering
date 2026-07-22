"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";
import { Label } from "@/components/ui/label";

export function DepartmentFilterDropdown({
  departments,
  selected,
  onChange,
}: {
  departments: string[];
  selected: string[];
  onChange: (departments: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleDepartment(department: string) {
    onChange(
      selected.includes(department)
        ? selected.filter((d) => d !== department)
        : [...selected, department],
    );
  }

  const label =
    selected.length === 0
      ? "All departments"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} departments selected`;

  return (
    <div ref={containerRef} className="relative">
      <Label>Department filters</Label>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "mt-1 flex h-10 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm",
          "transition hover:border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
          open && "border-emerald-500 ring-2 ring-emerald-500/20",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={cn("truncate", selected.length === 0 && "text-zinc-500")}>
          {label}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-zinc-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
          {departments.length === 0 ? (
            <p className="px-3 py-2 text-sm text-zinc-500">No departments available</p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                <button
                  type="button"
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                  onClick={() => onChange(departments)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
                  onClick={() => onChange([])}
                >
                  Clear
                </button>
              </div>
              <ul className="max-h-48 overflow-y-auto py-1" role="listbox">
                {departments.map((department) => {
                  const checked = selected.includes(department);
                  return (
                    <li key={department}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50",
                          checked && "bg-emerald-50/50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-zinc-300 bg-white",
                          )}
                        >
                          {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleDepartment(department)}
                        />
                        <span className="text-zinc-800">{department}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}

      <p className="mt-1 text-xs text-zinc-500">Leave empty to include all departments.</p>
    </div>
  );
}
