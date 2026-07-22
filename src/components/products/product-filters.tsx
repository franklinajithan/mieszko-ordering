"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/input";

type Store = { id: string; name: string; code: string };

export function ProductFilters({
  stores,
  departments,
}: {
  stores: Store[];
  departments: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/products?${params.toString()}`);
  }

  return (
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
      <div>
        <Label>Store</Label>
        <Select
          defaultValue={searchParams.get("storeId") ?? ""}
          onChange={(e) => update("storeId", e.target.value)}
        >
          <option value="">All stores</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Department</Label>
        <Select
          defaultValue={searchParams.get("department") ?? ""}
          onChange={(e) => update("department", e.target.value)}
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
