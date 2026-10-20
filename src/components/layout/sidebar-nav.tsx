"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BookOpen,
  FileSpreadsheet,
  Home,
  Layers,
  LayoutDashboard,
  Package,
  AlertTriangle,
  Store,
  Tags,
  Trash2,
  TrendingUp,
  Truck,
  BadgePercent,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/utils/cn";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
      { href:"/operations",label:"Office Operations",icon:LayoutDashboard },
      { href:"/data-quality",label:"Data Quality",icon:Layers },
      { href: "/automation", label: "CRM Downloads", icon: FileSpreadsheet },
      { href: "/downloads", label: "Download Queue", icon: FileSpreadsheet },
    ],
  },
  {
    title: "Catalog",
    items: [
      {
        href: "/products",
        label: "Products",
        icon: Package,
        match: (p) => p.startsWith("/products"),
      },
      {
        href: "/unmatched-products",
        label: "Unmatched Products",
        icon: AlertTriangle,
      },
      {
        href: "/departments",
        label: "Departments",
        icon: Layers,
        match: (p) => p.startsWith("/departments"),
      },
      {
        href: "/stores",
        label: "Stores & Suppliers",
        icon: Store,
        match: (p) => p.startsWith("/stores"),
      },
    ],
  },
  {
    title: "Imports",
    items: [
      { href: "/daily-sales", label: "Daily Sales", icon: TrendingUp },
      {
        href: "/promo-sales",
        label: "Promo Sales",
        icon: BadgePercent,
        match: (p) => p.startsWith("/promo-sales"),
      },
      { href: "/supplier-prices", label: "Supplier Prices", icon: Truck },
      {
        href: "/supplier-codes",
        label: "Supplier Codes",
        icon: Tags,
        match: (p) => p.startsWith("/supplier-codes"),
      },
      {
        href: "/book-stock",
        label: "Book Stock",
        icon: BookOpen,
        match: (p) => p.startsWith("/book-stock"),
      },
      {
        href: "/rtc",
        label: "RTC (Reduce to Clear)",
        icon: ArrowLeftRight,
        match: (p) => p.startsWith("/rtc"),
      },
      {
        href: "/wastage",
        label: "Wastage",
        icon: Trash2,
        match: (p) => p.startsWith("/wastage"),
      },
    ],
  },
  {
    title: "Ordering",
    items: [
      {href:"/orders",label:"Order History",icon:FileSpreadsheet,match:p=>p.startsWith("/orders")},
      {
        href: "/order-sheet",
        label: "Order Sheet",
        icon: FileSpreadsheet,
        match: (p) => p.startsWith("/order-sheet"),
      },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.match) return item.match(pathname);
  return pathname === item.href;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-6 px-3 py-2">
      {navGroups.map((group) => (
        <div key={group.title}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                      active
                        ? "bg-sidebar-accent text-white shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-white",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-white" : "text-sidebar-muted group-hover:text-white",
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <Link href="/" className="flex items-center gap-3 px-3 py-1">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-accent shadow-lg shadow-emerald-900/30">
        <LayoutDashboard className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">Mieszko</p>
        <p className="text-xs text-sidebar-muted">Ordering System</p>
      </div>
    </Link>
  );
}
