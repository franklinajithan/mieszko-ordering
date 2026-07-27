"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, Store, X } from "lucide-react";
import type { DepartmentOption } from "@/types/department";
import { Label } from "@/components/ui/label";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/utils/cn";

type StoreOption = { id: number; name: string; code: string };

export function ProductFilters({
  stores,
  departments,
  variant = "default",
  activeDepartment,
  activeStatus,
  activeSearch,
}: {
  stores: StoreOption[];
  departments: DepartmentOption[];
  variant?: "default" | "catalog";
  activeDepartment?: string;
  activeStatus?: string;
  activeSearch?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("search") ?? "");

  useEffect(() => {
    setSearchValue(searchParams.get("search") ?? "");
  }, [searchParams]);

  function update(key: string, value: string, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (resetPage) params.delete("page");
    router.push(`/products?${params.toString()}`);
  }

  function clearFilter(key: string) {
    if (key === "active") update("active", "true");
    else if (key === "search") {
      setSearchValue("");
      update("search", "");
    } else update(key, "");
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      const current = searchParams.get("search") ?? "";
      if (searchValue === current) return;
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) params.set("search", searchValue);
      else params.delete("search");
      params.delete("page");
      router.push(`/products?${params.toString()}`);
    }, 350);
    return () => clearTimeout(timeout);
  }, [searchValue, searchParams, router]);

  const storeSelected = Boolean(searchParams.get("storeId"));
  const statusValue = activeStatus ?? searchParams.get("active") ?? "true";

  const departmentNameById = useMemo(
    () => new Map(departments.map((department) => [String(department.id), department.name])),
    [departments],
  );

  const chips = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [];
    if (activeSearch) items.push({ key: "search", label: `Search: ${activeSearch}` });
    if (activeDepartment) {
      const label =
        departmentNameById.get(activeDepartment) ?? activeDepartment;
      items.push({ key: "department", label: `Order: ${label}` });
    }
    if (statusValue && statusValue !== "true") {
      items.push({
        key: "active",
        label:
          statusValue === "false" ? "Inactive only" : "All statuses",
      });
    }
    return items;
  }, [activeDepartment, activeSearch, departmentNameById, statusValue]);

  const isCatalog = variant === "catalog";

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "grid gap-3",
          isCatalog
            ? "lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]"
            : "md:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {!isCatalog ? (
          <FilterField label="Store" icon={Store}>
            <Select
              defaultValue={searchParams.get("storeId") ?? ""}
              onChange={(e) => update("storeId", e.target.value)}
            >
              <option value="" disabled>
                Select store
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </FilterField>
        ) : null}

        <FilterField label="Search products" icon={Search} className={isCatalog ? "lg:col-span-1" : ""}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Name or store code…"
              className="pl-9"
              disabled={!storeSelected && !isCatalog}
            />
          </div>
        </FilterField>

        <FilterField label="Order department">
          <Select
            defaultValue={searchParams.get("department") ?? ""}
            onChange={(e) => update("department", e.target.value)}
            disabled={!storeSelected}
          >
            <option value="">All order departments</option>
            {departments.map((department) => (
              <option key={department.id} value={String(department.id)}>
                {department.name}
              </option>
            ))}
          </Select>
        </FilterField>

        <FilterField label="Status">
          <Select
            defaultValue={statusValue}
            onChange={(e) => update("active", e.target.value)}
            disabled={!storeSelected}
          >
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
            <option value="all">All</option>
          </Select>
        </FilterField>

        {!isCatalog ? null : (
          <FilterField label="Store">
            <Select
              defaultValue={searchParams.get("storeId") ?? ""}
              onChange={(e) => update("storeId", e.target.value)}
            >
              <option value="" disabled>
                Select store
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Active filters</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => clearFilter(chip.key)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-white"
            >
              {chip.label}
              <X className="h-3 w-3 opacity-60" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterField({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
        {label}
      </Label>
      {children}
    </div>
  );
}
