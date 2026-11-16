"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addBarcode,
  addSupplierProductMapping,
  assignOrderDepartment,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatSupplierCodeDisplay } from "@/lib/supplier-code-unavailable";
import type { Product } from "@/types/product";
import type { DepartmentOption } from "@/types/department";

type Barcode = { id: number; barcode: string };
type SupplierProduct = {
  supplierProduct: { supplierCode: string; isActive?: boolean };
  supplier: { code: string; name: string };
};
type Supplier = { id: number; code: string; name: string };

export function ProductDetailForms({
  productId,
  storeId,
  product,
  departments,
  barcodes,
  supplierProducts,
  suppliers,
}: {
  productId: number;
  storeId?: number;
  product: Product;
  departments: DepartmentOption[];
  barcodes: Barcode[];
  supplierProducts: SupplierProduct[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [supplierMode, setSupplierMode] = useState<"code" | "unavailable">(
    "code",
  );

  async function onBarcode(formData: FormData) {
    setError(null);
    if (!storeId) {
      setError("Open this product from a store catalog to add barcodes.");
      return;
    }
    const result = await addBarcode({
      productId,
      storeId,
      barcode: formData.get("barcode"),
    });
    if (!result.success) setError(result.error);
    else router.refresh();
  }

  async function onSupplierProduct(formData: FormData) {
    setError(null);
    const supplierId = formData.get("supplierId");
    if (supplierMode === "unavailable") {
      const result = await addSupplierProductMapping({
        productId,
        supplierId,
        unavailable: true,
        isActive: false,
      });
      if (!result.success) setError(result.error);
      else {
        setSupplierMode("code");
        router.refresh();
      }
      return;
    }
    const result = await addSupplierProductMapping({
      productId,
      supplierId,
      supplierCode: formData.get("supplierCode"),
      isActive: true,
    });
    if (!result.success) setError(result.error);
    else router.refresh();
  }

  async function onOrderDepartment(formData: FormData) {
    setError(null);
    const raw = String(formData.get("orderDepartment") ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    const result = await assignOrderDepartment({
      productId,
      orderDepartment: Number.isInteger(value) && value! > 0 ? value : null,
    });
    if (!result.success) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border bg-white p-4 lg:col-span-2">
        <h2 className="font-semibold">Departments</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Imported department</Label>
            <Input value={product.department} readOnly className="bg-zinc-50" />
            <p className="mt-1 text-xs text-zinc-500">
              From ERP/import. Re-import updates this, not order department.
            </p>
          </div>
          <form action={onOrderDepartment} className="space-y-2">
            <div>
              <Label>Order department</Label>
              <Select
                name="orderDepartment"
                defaultValue={
                  product.orderDepartment != null
                    ? String(product.orderDepartment)
                    : ""
                }
              >
                <option value="">Unassigned</option>
                {departments.map((department) => (
                  <option key={department.id} value={String(department.id)}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Save order department</Button>
          </form>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Barcodes</h2>
        <p className="text-xs text-zinc-500">
          Linked to this store&apos;s product code (not shared across stores).
        </p>
        <ul className="space-y-1 text-sm">
          {barcodes.map((barcode) => (
            <li key={barcode.id}>{barcode.barcode}</li>
          ))}
        </ul>
        <form action={onBarcode} className="flex gap-2">
          <Input name="barcode" placeholder="Barcode" required disabled={!storeId} />
          <Button type="submit" disabled={!storeId}>
            Add
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Supplier codes</h2>
        <ul className="space-y-1 text-sm">
          {supplierProducts.map(({ supplierProduct, supplier }) => (
            <li key={`${supplier.code}-${supplierProduct.supplierCode}`}>
              {supplier.code}:{" "}
              {formatSupplierCodeDisplay(
                supplierProduct.supplierCode,
                supplier.code,
              )}
            </li>
          ))}
        </ul>
        <form action={onSupplierProduct} className="grid gap-2">
          <div>
            <Label>Supplier</Label>
            <Select name="supplierId" required defaultValue="">
              <option value="" disabled>
                Select supplier
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mapping</Label>
            <Select
              value={supplierMode}
              onChange={(e) =>
                setSupplierMode(
                  e.target.value === "unavailable" ? "unavailable" : "code",
                )
              }
            >
              <option value="code">Supplier code</option>
              <option value="unavailable">Not with this supplier</option>
            </Select>
          </div>
          {supplierMode === "code" ? (
            <div>
              <Label>Supplier code</Label>
              <Input name="supplierCode" required placeholder="e.g. 12345" />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Saves as confirmed unavailable for the selected supplier (same as
              spreadsheet “Not in MM / SP / WAB”).
            </p>
          )}
          <Button type="submit">
            {supplierMode === "unavailable"
              ? "Mark not with supplier"
              : "Add supplier code"}
          </Button>
        </form>
      </section>

      {error ? <p className="text-sm text-red-600 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
