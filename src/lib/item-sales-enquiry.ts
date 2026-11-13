import { z } from "zod";

export const report6Stores = {
  HNS: "Hounslow",
  STR: "Streatham",
  GRV: "Gravesend",
  WTF: "Watford",
  EAS: "Eastham",
  HYS: "Hayes",
  PVL: "Perivale",
} as const;
export const report6Store = z.enum(["HNS", "STR", "GRV", "WTF", "EAS", "HYS", "PVL"]);
export const report6Date = z.iso.date();
export const report6Id = z.uuid({ version: "v4" });
export const report6Key = z.object({ store: report6Store, date: report6Date });
export const report6Api = "/api/reports/item-sales-enquiry";

export type Report6Store = keyof typeof report6Stores;
export type Report6Key = z.infer<typeof report6Key>;
export type Report6Row = Report6Key & {
  state: "waiting" | "running" | "completed" | "skipped" | "failed" | "cancelled";
  message: string;
};
export type Report6Summary = {
  id: string;
  state: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt: number | null;
  start: string;
  end: string;
  total: number;
  failed: number;
};
export type Report6Job = Omit<Report6Summary, "total" | "failed"> & {
  current: Report6Key | null;
  force: boolean;
  reports: Report6Row[];
  cancelling?: boolean;
};

export function report6Days(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
}

export function report6Filename({ store, date }: Report6Key) {
  return `Item_Sales_Enquiry_${report6Stores[store]}_${date}.xlsx`;
}

export function report6ZipFilename(date: string) {
  return `Report6_Item_Sales_${date}.zip`;
}
