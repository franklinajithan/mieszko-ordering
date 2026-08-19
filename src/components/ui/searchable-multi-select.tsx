"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Label } from "@/components/ui/label";

export type MultiSelectOption = {
  id: number;
  label: string;
  hint?: string;
};

export function SearchableMultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
  required,
  error,
  compact = false,
}: {
  label: string;
  placeholder: string;
  options: MultiSelectOption[];
  selected: number[];
  onChange: (ids: number[]) => void;
  required?: boolean;
  error?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selectedOptions = options.filter((option) => selected.includes(option.id));

  function toggle(id: number) {
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  }

  function remove(id: number) {
    onChange(selected.filter((value) => value !== id));
  }

  return (
    <div ref={containerRef} className={compact ? "space-y-1" : "space-y-2"}>
      <Label className={compact ? "text-xs" : undefined}>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border bg-white px-3 text-sm",
            compact ? "min-h-9 py-1.5" : "min-h-10 py-2",
            error ? "border-red-300" : "border-zinc-200",
          )}
        >
          <span className={cn(selected.length === 0 && "text-zinc-500")}>
            {selected.length === 0
              ? placeholder
              : `${selected.length} selected`}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-zinc-400", open && "rotate-180")} />
        </button>
        {open ? (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg">
            <div className="border-b border-zinc-100 p-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
                className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <ul className="max-h-52 overflow-y-auto py-1">
              {filtered.map((option) => {
                const checked = selected.includes(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => toggle(option.id)}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50",
                        checked && "bg-blue-50/60",
                      )}
                      title={option.hint}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-zinc-300 bg-white",
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span>
                        <span className="font-medium text-zinc-900">{option.label}</span>
                        {option.hint ? (
                          <span className="block text-xs text-zinc-500">{option.hint}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      {selectedOptions.length && !compact ? (
        <div className="flex flex-wrap gap-2">
          {selectedOptions.map((option) => (
            <span
              key={option.id}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-900"
              title={option.hint}
            >
              {option.label}
              <button
                type="button"
                onClick={() => remove(option.id)}
                className="rounded-full p-0.5 hover:bg-blue-100"
                aria-label={`Remove ${option.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
