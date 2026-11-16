import { z } from "zod";
import { report6Date, report6Days, report6Store, report6Stores } from "@/lib/item-sales-enquiry";

export const downloaderApi = "/api/reports/downloader";
export const reportNames = {
  item_sales: "Item Sales (Report 6)",
  rtc: "RTC",
  wastage: "Wastage",
  stock_adjustment_extra: "Stock Adjustment Extra",
  daily_item_volume: "Daily Item Volume (Report 22)",
} as const;
export const reportRange = z.object({
  report: z.enum(Object.keys(reportNames) as (keyof typeof reportNames)[]),
  start: report6Date,
  end: report6Date,
}).refine(({ start, end }) => report6Days(start, end) >= 1 && report6Days(start, end) <= 366);
export const downloadPlan = z.object({
  stores: z.array(report6Store).min(1).max(7),
  ranges: z.array(reportRange).min(1).max(50),
});
export type DownloadPlan = z.infer<typeof downloadPlan>;
export const downloaderStores = report6Stores;

export type DownloadRow = DownloadPlan["ranges"][number] & {
  store: DownloadPlan["stores"][number];
  state: "waiting" | "running" | "completed" | "skipped" | "failed";
  message: string;
};
export type DownloadJob = {
  id: string;
  startedAt: number;
  state: "running" | "completed" | "failed";
  reports: DownloadRow[];
  zipReady: boolean;
  error?: string;
};
