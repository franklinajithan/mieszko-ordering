"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addBarcode, addSupplierProductMapping } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Barcode = { id: string; barcode: string };
type SupplierProduct = {
  supplierProduct: { supplierCode: string };
  supplier: { code: string; name: string };
};
type Supplier = { id: string; code: string; name: string };

export function ProductDetailForms({
  productId,
  barcodes,
  supplierProducts,
  suppliers,
}: {
  productId: string;
  barcodes: Barcode[];
  supplierProducts: SupplierProduct[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onBarcode(formData: FormData) {
    setError(null);
    const result = await addBarcode({
      productId,
      barcode: formData.get("barcode"),
    });
    if (!result.success) setError(result.error);
    else router.refresh();
  }

  async function onSupplierProduct(formData: FormData) {
    setError(null);
    const result = await addSupplierProductMapping({
      productId,
      supplierId: formData.get("supplierId"),
      supplierCode: formData.get("supplierCode"),
      isActive: true,
    });
    if (!result.success) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Barcodes</h2>
        <ul className="space-y-1 text-sm">
          {barcodes.map((barcode) => (
            <li key={barcode.id}>{barcode.barcode}</li>
          ))}
        </ul>
        <form action={onBarcode} className="flex gap-2">
          <Input name="barcode" placeholder="Barcode" required />
          <Button type="submit">Add</Button>
        </form>
      </section>

      <section className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Supplier codes</h2>
        <ul className="space-y-1 text-sm">
          {supplierProducts.map(({ supplierProduct, supplier }) => (
            <li key={`${supplier.code}-${supplierProduct.supplierCode}`}>
              {supplier.code}: {supplierProduct.supplierCode}
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
            <Label>Supplier code</Label>
            <Input name="supplierCode" required />
          </div>
          <Button type="submit">Add supplier code</Button>
        </form>
      </section>

      {error ? <p className="text-sm text-red-600 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
