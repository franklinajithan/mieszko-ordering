"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ERP_MISMATCH_EVENT,
  isErpMismatchMessage,
} from "@/utils/erp-file-validation";

export function ErpMismatchModalHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function onMismatch(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && isErpMismatchMessage(detail)) {
        setMessage(detail);
      }
    }

    window.addEventListener(ERP_MISMATCH_EVENT, onMismatch);
    return () => window.removeEventListener(ERP_MISMATCH_EVENT, onMismatch);
  }, []);

  if (!message) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onClick={() => setMessage(null)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="erp-mismatch-title"
        aria-describedby="erp-mismatch-body"
        className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-red-100 p-2 text-red-700">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="erp-mismatch-title" className="text-lg font-semibold text-zinc-900">
              Wrong file for this store
            </h2>
            <p id="erp-mismatch-body" className="mt-2 text-sm leading-relaxed text-zinc-600">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={() => setMessage(null)}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
