import * as XLSX from "xlsx";
import { isIsoDateString } from "@/utils/iso-date";
import { todayIso } from "@/utils/order-sheet-form";
import { InputError } from "@/utils/input-error";
import type { AdmCatalogItem } from "./types";

const storeNames: Record<string, string[]> = {
  PERIVALE: ["PVL", "0766"],
  HOUNSLOW: ["HNS", "0365"],
  SUDBURY: ["SBH", "SUDBURYHILL"],
  STREATHAM: ["STR", "0388", "STRETHAM"],
  GRAVESEND: ["GRV", "0566"],
  WATFORD: ["WTF", "0602"],
  HAYES: ["HYS", "0665"],
  EASTHAM: ["EAS", "0650"],
  MITCHAM: ["MIT"],
};

export const isMisplacedAdmCode = (code: string) => /^(?:\.+|\d{1,3}|\d+\.\d+)$/.test(code);

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function admShopKey(value: string) {
  const key = normalize(value).replace(/^MIESZKO/, "");
  return Object.entries(storeNames).find(([name, aliases]) => key === name || aliases.includes(key))?.[0];
}

function deliveryDate(value: unknown) {
  if (typeof value !== "string") return null;
  const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  const date = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : value.trim();
  return isIsoDateString(date) ? date : null;
}

export function admWorkbookCutoff(filename: string, today = todayIso()) {
  const match = /(\d{2})-(\d{2})-(\d{4})\.xlsx$/i.exec(filename);
  const date = match ? `${match[3]}-${match[2]}-${match[1]}` : null;
  return isIsoDateString(date) && date <= today ? date : today;
}

export function parseAdmWorkbook(buffer: ArrayBuffer, today: string) {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", sheetRows: 500 });
  } catch {
    throw new InputError("Could not read the ADM workbook. Upload an Excel .xlsx file.");
  }
  const catalogs = new Map<string, { items: AdmCatalogItem[]; previousDate: string | null }>();
  for (const sheet of workbook.SheetNames) {
    const shop = admShopKey(sheet);
    if (!shop) continue;
    if (catalogs.has(shop)) throw new InputError(`More than one worksheet matches ${shop}.`);
    // Start at A1 to preserve absolute header positions even when leading cells are empty.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, range: 0, blankrows: false });
    const headerIndex = rows.findIndex((row) => row.some((value) => normalize(String(value)) === "PRODUCTNAME")
      && row.some((value) => normalize(String(value)) === "ITEMCODE"));
    if (headerIndex < 0) throw new InputError(`Missing Item Code or Product Name header in ${sheet}.`);
    const header = rows[headerIndex];
    const productColumn = header.findIndex((value) => normalize(String(value)) === "PRODUCTNAME");
    const codeColumn = header.findIndex((value) => normalize(String(value)) === "ITEMCODE");
    const sourceRows = rows.slice(headerIndex + 1);
    const isQuantity = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    const orderColumns = header.flatMap((value, column) => {
      const date = deliveryDate(value);
      return date && date < today && sourceRows.some((row) => isQuantity(row[column])) ? [{ date, column }] : [];
    }).sort((a, b) => b.date.localeCompare(a.date) || b.column - a.column);
    const previousOrders = [...new Map([...orderColumns].reverse().map((order) => [order.date, order])).values()]
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
    const previous = previousOrders[0];
    const names = new Set<string>();
    const items = sourceRows.flatMap((row) => {
      const product = row[productColumn];
      const unit = row[productColumn + 1];
      if (typeof product !== "string" || !product.trim() || !unit) return [];
      const name = product.trim().replace(/\s+/g, " ");
      if (names.has(name)) throw new InputError(`Duplicate product in ${sheet} — ${name}.`);
      names.add(name);
      const code = String(row[codeColumn] ?? "").trim() || null;
      const barcode = productColumn - codeColumn === 2 ? String(row[productColumn - 1] ?? "").trim() : "";
      const salesUnit = { KG: "kg", SZT: "pcs", PCS: "pcs" }[String(unit).trim().toUpperCase()] ?? null;
      const qty = previous ? row[previous.column] : null;
      return [{ name, code, barcode: /^\d+$/.test(barcode) ? barcode : null, salesUnit, previousQty: isQuantity(qty) ? qty : null,
        previousOrders: Object.fromEntries(previousOrders.map(({ date, column }) => [
          date, isQuantity(row[column]) ? row[column] : null,
        ])),
      }];
    });
    if (!items.length) throw new InputError(`No ADM products found in ${sheet}.`);
    catalogs.set(shop, { items, previousDate: previous?.date ?? null });
  }
  if (!catalogs.size) throw new InputError("The Excel file has no recognized ADM shop tabs.");
  const referenceCodes = new Map<string, Set<string>>();
  for (const { items } of catalogs.values()) {
    for (const { name, code } of items) {
      if (!code || !/^M\d+$/i.test(code)) continue;
      const matches = referenceCodes.get(name) ?? new Set<string>();
      matches.add(code.toUpperCase());
      referenceCodes.set(name, matches);
    }
  }
  for (const [shop, { items }] of catalogs) {
    if (shop === "SUDBURY" || shop === "MITCHAM") continue;
    for (const item of items) {
      if (!item.code || !isMisplacedAdmCode(item.code)) continue;
      const matches = referenceCodes.get(item.name);
      item.code = matches?.size === 1 ? [...matches][0] : null;
    }
  }
  return catalogs;
}
