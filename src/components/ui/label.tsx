import { cn } from "@/utils/cn";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-medium text-zinc-800", className)}
      {...props}
    />
  );
}
