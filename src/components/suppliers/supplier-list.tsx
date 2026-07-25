"use client";

import type { Supplier } from "@/types/supplier";
import { Badge } from "@/components/ui/badge";
import { SupplierToggleButton } from "@/components/stores/store-actions";

export function SupplierList({ suppliers }: { suppliers: Supplier[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Tie priority</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((supplier) => (
            <tr key={supplier.id}>
              <td className="px-4 py-3 font-medium">{supplier.code}</td>
              <td className="px-4 py-3">{supplier.name}</td>
              <td className="px-4 py-3">{supplier.priceTiePriority}</td>
              <td className="px-4 py-3">
                <Badge status={supplier.isActive ? "active" : "inactive"}>
                  {supplier.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <SupplierToggleButton
                  id={supplier.id}
                  isActive={supplier.isActive}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
