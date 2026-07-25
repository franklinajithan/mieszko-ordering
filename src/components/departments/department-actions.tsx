"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  toggleDepartmentActive,
  updateDepartmentDetails,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Department = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
};

export function DepartmentRowActions({ department }: { department: Department }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(department.name);
  const [code, setCode] = useState(department.code ?? "");

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setName(department.name);
    setCode(department.code ?? "");
  }

  async function saveEdit() {
    setError(null);
    const result = await updateDepartmentDetails({
      id: department.id,
      name: name.trim(),
      code: code.trim() || undefined,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={saveEdit} disabled={pending || !name.trim()}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={cancelEdit}>
            Cancel
          </Button>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await toggleDepartmentActive(department.id, !department.isActive);
            router.refresh();
          })
        }
      >
        {department.isActive ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}
