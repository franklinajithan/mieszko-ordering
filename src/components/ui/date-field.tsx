"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}

function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function dayDisabled(date: Date, min?: string, max?: string): boolean {
  const iso = toIsoDate(date);
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

export type DateFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> & {
  value?: string;
  defaultValue?: string;
  variant?: "default" | "compact";
  placeholder?: string;
};

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  function DateField(
    {
      className,
      disabled,
      name,
      required,
      onChange,
      id,
      value: valueProp,
      defaultValue,
      min,
      max,
      variant = "default",
      placeholder = "Select date",
      ...rest
    },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const isControlled = valueProp !== undefined;

    const [internalValue, setInternalValue] = React.useState(
      () => valueProp ?? defaultValue ?? "",
    );
    const isoValue = isControlled ? (valueProp ?? "") : internalValue;
    const selectedDate = parseIsoDate(isoValue);

    const [open, setOpen] = React.useState(false);
    const [viewMonth, setViewMonth] = React.useState(
      () => selectedDate ?? new Date(),
    );

    React.useEffect(() => {
      if (isControlled) setInternalValue(valueProp ?? "");
    }, [isControlled, valueProp]);

    React.useEffect(() => {
      if (selectedDate) setViewMonth(selectedDate);
    }, [isoValue]);

    React.useEffect(() => {
      if (!open) return;
      function onPointerDown(event: MouseEvent) {
        if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
      }
      document.addEventListener("mousedown", onPointerDown);
      return () => document.removeEventListener("mousedown", onPointerDown);
    }, [open]);

    function setInputRef(el: HTMLInputElement | null) {
      inputRef.current = el;
      assignRef(ref, el);
    }

    function commitValue(nextIso: string) {
      if (!isControlled) setInternalValue(nextIso);
      const input = inputRef.current;
      if (input) input.value = nextIso;
      onChange?.({
        target: input ?? { value: nextIso },
        currentTarget: input ?? { value: nextIso },
      } as React.ChangeEvent<HTMLInputElement>);
    }

    function pickDate(date: Date) {
      if (dayDisabled(date, min as string | undefined, max as string | undefined)) {
        return;
      }
      commitValue(toIsoDate(date));
      setOpen(false);
    }

    function onNativeChange(event: React.ChangeEvent<HTMLInputElement>) {
      const next = event.target.value;
      if (!isControlled) setInternalValue(next);
      onChange?.(event);
      const parsed = parseIsoDate(next);
      if (parsed) setViewMonth(parsed);
    }

    const monthStart = startOfMonth(viewMonth);
    const calendarDays = eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 }),
    });

    const isCompact = variant === "compact";
    const displayLabel = selectedDate
      ? format(selectedDate, "d MMM yyyy")
      : placeholder;

    return (
      <div ref={rootRef} className={cn("relative w-full", className)}>
        <input
          {...rest}
          ref={setInputRef}
          id={inputId}
          type="date"
          name={name}
          value={isoValue}
          required={required}
          disabled={disabled}
          min={min}
          max={max}
          onChange={onNativeChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />

        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border bg-white transition-all",
            isCompact ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-sm",
            open
              ? "border-emerald-500 ring-2 ring-emerald-500/20"
              : "border-zinc-300 hover:border-emerald-400",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <button
            type="button"
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={`${inputId}-calendar`}
            onClick={() => !disabled && setOpen((v) => !v)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 text-left",
              disabled && "pointer-events-none",
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 ring-1 ring-emerald-200/80",
                isCompact ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              <CalendarDays
                className={cn("text-emerald-700", isCompact ? "h-3.5 w-3.5" : "h-4 w-4")}
                aria-hidden
              />
            </span>
            <span
              className={cn(
                "truncate font-medium",
                selectedDate ? "text-zinc-900" : "text-zinc-500",
              )}
            >
              {displayLabel}
            </span>
          </button>
        </div>

        {open ? (
          <div
            id={`${inputId}-calendar`}
            role="dialog"
            aria-label="Choose date"
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[280px] min-w-[280px] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg ring-1 ring-black/5"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100"
                aria-label="Previous month"
                onClick={() => setViewMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-sm font-semibold text-zinc-900">
                {format(viewMonth, "MMMM yyyy")}
              </p>
              <button
                type="button"
                className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100"
                aria-label="Next month"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d} className="py-1">
                  {d}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {calendarDays.map((day) => {
                const inMonth = isSameMonth(day, viewMonth);
                const selected = selectedDate ? isSameDay(day, selectedDate) : false;
                const today = isToday(day);
                const offRange = dayDisabled(
                  day,
                  min as string | undefined,
                  max as string | undefined,
                );

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={offRange}
                    onClick={() => pickDate(day)}
                    className={cn(
                      "aspect-square rounded-lg text-xs font-medium transition-colors",
                      !inMonth && "text-zinc-300",
                      inMonth && !selected && !offRange && "text-zinc-800 hover:bg-emerald-50",
                      selected &&
                        "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
                      today && !selected && inMonth && "ring-1 ring-emerald-400/60",
                      offRange && "cursor-not-allowed text-zinc-200",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex justify-between gap-2 border-t border-zinc-100 pt-2">
              <button
                type="button"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                onClick={() => {
                  setViewMonth(new Date());
                  pickDate(new Date());
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

DateField.displayName = "DateField";
