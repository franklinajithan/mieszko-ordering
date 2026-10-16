import { z } from "zod";
import { isIsoDateString } from "@/utils/iso-date";

export const movementFeeds = ["normal_sales", "rtc", "wastage"] as const;
export const crmStoreSettingsSchema = z.object({
  crmUrl: z.string().trim().min(1).max(2048).superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
          url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an HTTP or HTTPS CRM URL without credentials, query parameters or a fragment." });
    }
  }),
  nightlyEnabled: z.boolean(),
});

/** Calendar dates, independent of daylight-saving changes. One job per day/feed. */
export function dailyImportDates(start: string, end: string): string[] {
  if (!isIsoDateString(start) || !isIsoDateString(end) || start > end) {
    throw new Error("Choose valid From and To dates in chronological order.");
  }
  const first = Date.parse(start + "T00:00:00Z");
  const count = (Date.parse(end + "T00:00:00Z") - first) / 86400000 + 1;
  if (count > 31) throw new Error("Choose at most 31 days per request.");
  return Array.from({ length: count }, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
}

export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const queueMovementSchema = z.object({
  storeIds: z.array(z.number().int().positive()).min(1).max(7),
  feeds: z.array(z.enum(movementFeeds)).min(1).max(3),
  startDate: z.string(),
  endDate: z.string(),
  replaceCompleted: z.boolean().default(false),
}).superRefine((value, ctx) => {
  try { dailyImportDates(value.startDate, value.endDate); }
  catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); }
  if (isIsoDateString(value.endDate) && value.endDate >= londonToday()) {
    ctx.addIssue({ code: "custom", message: "Choose completed days only, up to yesterday in London time." });
  }
});
