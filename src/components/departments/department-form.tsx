"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDepartment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DepartmentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const code = String(formData.get("code") ?? "").trim();
    const result = await createDepartment({
      name: formData.get("name"),
      code: code || undefined,
      isActive: true,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form
      action={onSubmit}
      className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"
    >
      <div>
        <Label htmlFor="dept-name">Name</Label>
        <Input id="dept-name" name="name" required placeholder="Dairy" />
      </div>
      <div>
        <Label htmlFor="dept-code">Code (optional)</Label>
        <Input id="dept-code" name="code" placeholder="DAIRY" />
      </div>
      <div className="flex items-end md:col-span-2">
        <Button type="submit">Add department</Button>
      </div>
      {error ? (
        <p className="text-sm text-red-600 md:col-span-4">{error}</p>
      ) : null}
    </form>
  );
}
