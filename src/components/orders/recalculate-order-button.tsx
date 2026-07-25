"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { calculateOrderAction } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function RecalculateOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await calculateOrderAction({ orderId });
          router.refresh();
        })
      }
    >
      {pending ? "Recalculating…" : "Recalculate"}
    </Button>
  );
}
