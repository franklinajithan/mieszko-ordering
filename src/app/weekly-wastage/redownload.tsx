"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

export function RedownloadWeek({ week, running }: { week: string; running: boolean }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [refreshing, refresh] = useTransition();
  const [error, setError] = useState("");

  async function start() {
    setStarting(true);
    setError("");
    try {
      const response = await fetch(`/api/weekly-wastage/${week}/redownload`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json();
        setError(result.error || "Could not start the weekly wastage worker.");
      }
      refresh(() => router.refresh());
    } catch {
      setError("Could not start the weekly wastage worker.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={running || starting || refreshing}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
      >
        <RefreshCw size={16} aria-hidden="true" />
        {starting ? "Starting…" : "Redownload week"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-800">{error}</p>}
    </div>
  );
}
