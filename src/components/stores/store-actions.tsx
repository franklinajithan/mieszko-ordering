"use client";

import { useTransition } from "react";
import { toggleStoreActive, toggleSupplierActive } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function StoreToggleButton({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleStoreActive(id, !isActive);
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

export function SupplierToggleButton({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleSupplierActive(id, !isActive);
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
