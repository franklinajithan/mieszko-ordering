"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createStore } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StoreForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await createStore({
      name: formData.get("name"),
      code: formData.get("code"),
      erpType: formData.get("erpType"),
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
        <Label htmlFor="code">Code</Label>
        <Input id="code" name="code" required />
      </div>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="erpType">ERP</Label>
        <Select id="erpType" name="erpType" defaultValue="msp">
          <option value="msp">MSP</option>
          <option value="glopos">GloPOS</option>
        </Select>
      </div>
      <div className="flex items-end">
        <Button type="submit">Create store</Button>
      </div>
      {error ? <p className="text-sm text-red-600 md:col-span-4">{error}</p> : null}
    </form>
  );
}
