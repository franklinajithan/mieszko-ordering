import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export function OrderSheetSection({
  number,
  title,
  children,
  className,
  compact = false,
}: {
  number: number;
  title: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        compact ? "space-y-3" : "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      <h2
        className={cn(
          "flex items-center gap-2 font-semibold text-zinc-900",
          compact ? "text-sm text-zinc-700" : "mb-1 text-base",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-blue-600 text-white",
            compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs",
          )}
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function OrderSheetPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}
