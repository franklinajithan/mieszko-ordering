"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input, Select } from "@/components/ui/input";

type Store = { id: number; name: string; code: string };

export function ProductFilters({
  stores,
  departments,
}: {
  stores: Store[];
  departments: string[];
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

  return (
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <Label>Store</Label>
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
      </div>
      <div>
        <Label>Search</Label>
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Name or store code"
        />
      </div>
      <div>
        <Label>Department</Label>
        <Select
          defaultValue={searchParams.get("department") ?? ""}
          onChange={(e) => update("department", e.target.value)}
          disabled={!searchParams.get("storeId")}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Active status</Label>
        <Select
          defaultValue={searchParams.get("active") ?? "true"}
          onChange={(e) => update("active", e.target.value)}
        >
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="all">All</option>
        </Select>
      </div>
    </div>
  );
}
