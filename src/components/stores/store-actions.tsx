"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toggleStoreActive, toggleSupplierActive, updateStore } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export function StoreToggleButton({
  id,
  isActive,
}: {
  id: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleStoreActive(id, !isActive);
          router.refresh();
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

export function StoreErpSelect({
  id,
  erpType,
}: {
  id: number;
  erpType: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={erpType}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          await updateStore({ id, erpType: e.target.value });
          router.refresh();
        })
      }
    >
      <option value="msp">MSP</option>
      <option value="glopos">GloPOS</option>
    </Select>
  );
}

export function SupplierToggleButton({
  id,
  isActive,
}: {
  id: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleSupplierActive(id, !isActive);
          router.refresh();
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
