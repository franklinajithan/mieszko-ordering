export function ImportProgressBar({
  label,
  detail,
  processed,
  total,
  done = false,
  unit = "files",
  percent: percentOverride,
  compact = false,
}: {
  label: string;
  detail?: string;
  processed?: number;
  total?: number;
  done?: boolean;
  unit?: string;
  percent?: number;
  compact?: boolean;
}) {
  const fromCounts = Math.round(
    ((processed ?? 0) / Math.max(1, total ?? 1)) * 100,
  );
  const percent = done
    ? 100
    : Math.max(
        8,
        Math.min(99, percentOverride != null ? Math.round(percentOverride) : fromCounts),
      );
  const showCounts = processed != null && total != null && percentOverride == null;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {compact ? null : <h4 className="font-semibold text-zinc-900">Progress</h4>}
      <p className={compact ? "text-sm font-medium text-zinc-900" : "font-medium text-zinc-900"}>
        {label}
      </p>
      {detail ? <p className="text-sm text-zinc-600">{detail}</p> : null}
      <div
        className="h-3 overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            done ? "bg-emerald-500" : "bg-emerald-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-zinc-600">
        {showCounts
          ? `${processed.toLocaleString()} of ${total.toLocaleString()} ${unit} · ${percent}%`
          : `${percent}%`}
      </p>
    </div>
  );
}
