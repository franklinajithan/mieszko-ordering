"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addStoreProduct,
  createProduct,
  importProducts,
} from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportResult } from "@/types";

type Store = { id: number; name: string };

export function ProductForms({
  stores,
}: {
  stores: Store[];
}) {
  const router = useRouter();
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createMasterProduct(formData: FormData) {
    setError(null);
    const productResult = await createProduct({
      name: formData.get("name"),
      department: formData.get("department"),
      isActive: true,
    });
    if (!productResult.success) {
      setError(productResult.error);
      return;
    }

    const mappingResult = await addStoreProduct({
      storeId: formData.get("storeId"),
      productId: productResult.data.id,
      storeProductCode: formData.get("storeProductCode"),
      isActive: true,
    });

    if (!mappingResult.success) {
      setError(mappingResult.error);
      return;
    }

    router.refresh();
  }

  async function onImport(formData: FormData) {
    setError(null);
    const result = await importProducts(formData);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setImportResult(result.data);
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={createMasterProduct} className="space-y-3 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">Create product</h3>
        <div>
          <Label>Name</Label>
          <Input name="name" required />
        </div>
        <div>
          <Label>Department</Label>
          <Input name="department" required />
        </div>
        <div>
          <Label>Store</Label>
          <Select name="storeId" required defaultValue="">
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
          <Label>Store product code</Label>
          <Input name="storeProductCode" required />
        </div>
        <Button type="submit">Create product</Button>
      </form>

      <form action={onImport} className="space-y-3 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">Import products from Excel</h3>
        <div>
          <Label>Store</Label>
          <Select name="storeId" required defaultValue="">
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
          <Label>File</Label>
          <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
        </div>
        <Button type="submit">Import</Button>
        {importResult ? <ImportSummary result={importResult} /> : null}
      </form>

      {error ? <p className="text-sm text-red-600 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
