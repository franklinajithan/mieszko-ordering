"use client";

import { Button } from "@/components/ui/button";

export function OrderSheetActionBar({
  orderId,
  generating,
  saving,
  onClear,
  onSave,
  onExport,
  onGenerate,
  onFinalise,
}: {
  orderId: number | null;
  generating: boolean;
  saving: boolean;
  onClear: () => void;
  onSave: () => void;
  onExport: () => void;
  onGenerate: () => void;
  onFinalise: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-64 lg:px-8">
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={onClear}>
          Clear All
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!orderId || saving}
          onClick={onSave}
        >
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button type="button" variant="outline" disabled={!orderId} onClick={onExport}>
          Export Excel
        </Button>
        <Button type="button" disabled={generating} onClick={onGenerate}>
          {generating ? "Generating..." : "Generate Order Sheet"}
        </Button>
        <Button type="button" variant="outline" disabled={!orderId} onClick={onFinalise}>
          Finalise Order
        </Button>
      </div>
    </div>
  );
}
