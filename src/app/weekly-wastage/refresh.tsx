"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export function RefreshWastageStatus() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-60"
    >
      {pending ? "Refreshing…" : "Refresh status"}
    </button>
  );
}
