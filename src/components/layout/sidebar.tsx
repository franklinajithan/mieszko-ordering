"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarBrand, SidebarNav } from "@/components/layout/sidebar-nav";
import { cn } from "@/utils/cn";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-700 shadow-sm lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Close menu overlay"
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between border-b border-sidebar-border p-4">
              <SidebarBrand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function DesktopSidebar() {
  return (
    <aside
      className={cn(
        "hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col",
        "border-r border-sidebar-border bg-sidebar",
      )}
    >
      <div className="border-b border-sidebar-border p-5">
        <SidebarBrand />
      </div>
      <SidebarNav />
      <div className="mt-auto border-t border-sidebar-border p-4">
        <p className="text-xs leading-relaxed text-sidebar-muted">
          Dairy ordering & supplier price comparison
        </p>
      </div>
    </aside>
  );
}
