import "server-only";
import * as XLSX from "xlsx";
import { downloadPlan, downloaderStores, type DownloadPlan } from "@/lib/report-downloader";

const names = new Map<string, DownloadPlan["ranges"][number]["report"]>([
  ["item sales", "item_sales"],
  ["rtc", "rtc"],
  ["wastage", "wastage"],
  ["stock adjustment", "stock_adjustment_extra"],
  ["stock adjustment extra", "stock_adjustment_extra"],
  ["daily item volume", "daily_item_volume"],
]);
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

async function rows(file: FormDataEntryValue | null, sheet: string): Promise<unknown[][]> {
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > 262_144) {
    throw new Error(`Select a valid ${sheet === "Control" ? "Report_Control" : "Stores"}.xlsx workbook (up to 256 KB).`);
  }
  const book = XLSX.read(await file.arrayBuffer(), { sheets: [sheet], sheetRows: 502, cellDates: true, WTF: true });
  const tab = book.Sheets[sheet];
  if (!tab || !tab["!ref"]) throw new Error(`Workbook must contain a ${sheet} sheet.`);
  const range = XLSX.utils.decode_range(tab["!ref"]);
  if (range.e.r >= 500 || range.e.c > 30) throw new Error(`The ${sheet} sheet exceeds the supported size.`);
  return XLSX.utils.sheet_to_json(tab, { header: 1, range: { s: { r: 0, c: 0 }, e: range.e } });
}

function dateText(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const uk = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  return uk ? `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}` : text;
}

export async function readDownloaderWorkbooks(form: FormData): Promise<DownloadPlan> {
  const [control, stores] = await Promise.all([rows(form.get("control"), "Control"), rows(form.get("stores"), "Stores")]);
  if (!["report", "range", "from date", "to date", "run"].every((name, i) => normalize(control[3]?.[i]) === name)) {
    throw new Error("The Control sheet needs Report, Range, From Date, To Date and Run in row 4.");
  }
  const enabled = stores[0]?.findIndex(value => normalize(value) === "enabled") ?? -1;
  const name = stores[0]?.findIndex(value => normalize(value) === "store") ?? -1;
  if (name < 0 || enabled < 0) throw new Error("The Stores sheet needs Store and Enabled columns.");
  const selected = new Set<DownloadPlan["stores"][number]>();
  for (const [i, row] of stores.slice(1).entries()) {
    if (row.every(value => !normalize(value))) continue;
    const flag = normalize(row[enabled]);
    if (flag !== "yes" && flag !== "no") throw new Error(`Stores row ${i + 2} needs YES or NO in Enabled.`);
    if (flag === "no") continue;
    const store = (Object.keys(downloaderStores) as DownloadPlan["stores"]).find(code =>
      normalize(code) === normalize(row[name]) || normalize(downloaderStores[code]) === normalize(row[name]).replace(/\s/g, ""));
    if (!store) throw new Error(`Stores row ${i + 2} has an unknown enabled store.`);
    if (selected.has(store)) throw new Error(`Stores row ${i + 2} repeats an enabled store.`);
    selected.add(store);
  }
  const ranges = new Map<string, DownloadPlan["ranges"][number] & { number: number }>();
  for (const [i, row] of control.slice(4).entries()) {
    if (normalize(row[4]) !== "yes") continue;
    const report = names.get(normalize(row[0]));
    const number = Number(row[1]);
    if (!report || !Number.isSafeInteger(number) || number < 1 ||
      (report === "item_sales" && number > 10) || (report === "daily_item_volume" && number !== 1)) {
      throw new Error(`Control row ${i + 5} has an invalid report or range number.`);
    }
    const key = `${report}/${number}`;
    if (ranges.has(key)) throw new Error(`Control row ${i + 5} repeats a range number for the same report.`);
    const start = dateText(row[2]);
    ranges.set(key, { report, number, start, end: normalize(row[3]) ? dateText(row[3]) : start });
  }
  const plan = downloadPlan.safeParse({
    stores: [...selected],
    ranges: [...ranges.values()].sort((a, b) => a.number - b.number),
  });
  if (!plan.success) throw new Error("Enable at least one store and report range. Each range must have valid dates and span up to 366 days (50 ranges maximum).");
  return plan.data;
}
