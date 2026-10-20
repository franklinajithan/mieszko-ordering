"use client";

import { Button } from "@/components/ui/button";
import { ImportProgressBar } from "@/components/ui/import-progress-bar";

export function OrderSheetActionBar({
  orderId,
  generating,
  generateProgress,
  saving,
  onClear,
  onSave,
  onExport,
  onExportDairy,
  onGenerate,
}: {
  orderId: number | null;
  generating: boolean;
  generateProgress: { percent: number; done: boolean } | null;
  saving: boolean;
  onClear: () => void;
  onSave: () => void;
  onExport: () => void;
  onExportDairy: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-64 lg:px-8">
      {generateProgress ? (
        <div className="mb-3 max-w-xl">
          <ImportProgressBar
            compact
            label={
              generateProgress.done
                ? "Order sheet generated"
                : "Generating order sheet…"
            }
            percent={generateProgress.percent}
            done={generateProgress.done}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={onClear} disabled={generating}>
          Clear All
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!orderId || saving || generating}
          onClick={onSave}
        >
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!orderId || generating || saving}
          onClick={onExport}
        >
          Export Excel
        </Button>
        <Button type="button" variant="outline" disabled={!orderId || generating || saving} onClick={onExportDairy} title="Product and NO Movement tabs per store. Enable Day-by-sales required for daily columns.">
          Dairy workbook
        </Button>
        <Button type="button" disabled={generating || saving} onClick={onGenerate}>
          {generating ? "Generating..." : "Generate Order Sheet"}
        </Button>
      </div>
    </div>
  );
}
