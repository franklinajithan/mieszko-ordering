"use client";

import * as React from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/utils/cn";

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export type FileUploadFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  hint?: string;
  variant?: "default" | "compact";
};

export const FileUploadField = React.forwardRef<HTMLInputElement, FileUploadFieldProps>(
  function FileUploadField(
    {
      className,
      accept = ".csv,.xlsx,.xls",
      disabled,
      name,
      required,
      onChange,
      id,
      hint,
      variant = "default",
      multiple,
      ...rest
    },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = React.useState(false);
    const [fileName, setFileName] = React.useState<string | null>(null);
    const autoId = React.useId();
    const inputId = id ?? autoId;

    function setInputRef(el: HTMLInputElement | null) {
      inputRef.current = el;
      assignRef(ref, el);
    }

    function syncFileNameFromInput() {
      const selected = inputRef.current?.files;
      if (!selected?.length) {
        setFileName(null);
        return;
      }
      if (selected.length === 1) {
        setFileName(selected[0].name);
        return;
      }
      setFileName(`${selected.length} files selected`);
    }

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      syncFileNameFromInput();
      onChange?.(event);
    }

    function applyFiles(files: File[]) {
      const input = inputRef.current;
      if (!input || !files.length) return;
      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      input.files = dt.files;
      syncFileNameFromInput();
      handleChange({
        target: input,
        currentTarget: input,
      } as React.ChangeEvent<HTMLInputElement>);
    }

    function handleDrop(event: React.DragEvent) {
      event.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dropped = Array.from(event.dataTransfer.files ?? []);
      if (!dropped.length) return;
      applyFiles(multiple ? dropped : dropped.slice(0, 1));
    }

    function clearFile(event: React.MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      const input = inputRef.current;
      if (!input) return;
      input.value = "";
      setFileName(null);
      handleChange({
        target: input,
        currentTarget: input,
      } as React.ChangeEvent<HTMLInputElement>);
    }

    const isCompact = variant === "compact";

    return (
      <div className={cn("w-full", className)}>
        <input
          {...rest}
          ref={setInputRef}
          id={inputId}
          type="file"
          name={name}
          accept={accept}
          required={required}
          disabled={disabled}
          multiple={multiple}
          onChange={handleChange}
          className="sr-only"
        />
        <label
          htmlFor={inputId}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "group relative flex cursor-pointer transition-all",
            disabled && "cursor-not-allowed opacity-60",
            isCompact
              ? "items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-3 py-2 hover:border-emerald-400 hover:bg-emerald-50/50"
              : "flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center hover:border-emerald-400 hover:bg-emerald-50/40",
            dragOver && "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20",
            fileName && !isCompact && "border-emerald-300/80 bg-emerald-50/30 py-4",
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-zinc-200/80",
              isCompact ? "h-9 w-9" : "h-11 w-11",
            )}
          >
            {fileName ? (
              <FileSpreadsheet
                className={cn("text-emerald-700", isCompact ? "h-4 w-4" : "h-5 w-5")}
                aria-hidden
              />
            ) : (
              <Upload
                className={cn("text-zinc-500 group-hover:text-emerald-700", isCompact ? "h-4 w-4" : "h-5 w-5")}
                aria-hidden
              />
            )}
          </div>

          <div className={cn("min-w-0", isCompact ? "flex-1 text-left" : "space-y-0.5")}>
            {fileName ? (
              <>
                <p className={cn("truncate font-medium text-zinc-900", isCompact ? "text-sm" : "text-sm")}>
                  {fileName}
                </p>
                {!isCompact ? (
                  <p className="text-xs text-zinc-500">
                    {multiple
                      ? "Click or drop files to replace"
                      : "Click or drop a file to replace"}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className={cn("font-medium text-zinc-800", isCompact ? "text-sm" : "text-sm")}>
                  Choose file or drag and drop
                </p>
                <p className="text-xs text-zinc-500">
                  {hint ?? "Spreadsheet (.csv, .xlsx, .xls)"}
                </p>
              </>
            )}
          </div>

          {!isCompact ? (
            <span className="mt-1 inline-flex items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm group-hover:bg-emerald-800">
              Browse files
            </span>
          ) : null}

          {fileName ? (
            <button
              type="button"
              onClick={clearFile}
              className={cn(
                "rounded-md p-1 text-zinc-400 hover:bg-white hover:text-zinc-700",
                isCompact ? "shrink-0" : "absolute right-3 top-3",
              )}
              aria-label="Clear file"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
      </div>
    );
  },
);

FileUploadField.displayName = "FileUploadField";
