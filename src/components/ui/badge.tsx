import { cn } from "@/utils/cn";
import { formatPriceStatus } from "@/utils/format";

const variants: Record<string, string> = {
  complete: "bg-emerald-100 text-emerald-800",
  check_missing_code: "bg-amber-100 text-amber-900",
  check_missing_price: "bg-amber-100 text-amber-900",
  check_invalid_price: "bg-red-100 text-red-800",
  pending: "bg-zinc-100 text-zinc-700",
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-zinc-100 text-zinc-600",
};

export function Badge({
  status,
  children,
  className,
}: {
  status?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const key = status ?? "pending";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[key] ?? variants.pending,
        className,
      )}
    >
      {children ?? (status ? formatPriceStatus(status) : "Pending")}
    </span>
  );
}
