"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupplier } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SupplierForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await createSupplier({
      name: formData.get("name"),
      code: formData.get("code"),
      priceTiePriority: Number(formData.get("priceTiePriority") ?? 0),
      isActive: true,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form action={onSubmit} className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
      <div>
        <Label htmlFor="supplier-code">Code</Label>
        <Input id="supplier-code" name="code" required />
      </div>
      <div>
        <Label htmlFor="supplier-name">Name</Label>
        <Input id="supplier-name" name="name" required />
      </div>
      <div>
        <Label htmlFor="priceTiePriority">Tie priority</Label>
        <Input id="priceTiePriority" name="priceTiePriority" type="number" defaultValue={0} />
      </div>
      <div className="flex items-end">
        <Button type="submit">Create supplier</Button>
      </div>
      {error ? <p className="text-sm text-red-600 md:col-span-4">{error}</p> : null}
    </form>
  );
}
