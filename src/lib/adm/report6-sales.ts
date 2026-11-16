import "server-only";
import * as XLSX from "xlsx";
import { Decimal } from "@/utils/decimal";
import { report6Store, type Report6Store } from "@/lib/item-sales-enquiry";
import { openReport6File } from "@/services/item-sales-enquiry.service";

const nebulaCodes: Record<string, Report6Store> = {
  "0365": "HNS", "0766": "PVL", "0650": "EAS", "0665": "HYS",
  "0566": "GRV", "0602": "WTF", "0388": "STR",
};

export function admReport6Store(code: string) {
  const result = report6Store.safeParse(nebulaCodes[code] ?? code.toUpperCase());
  return result.success ? result.data : null;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const itemHeaders = new Set(["itemcode", "productitemcode", "productcode", "itemnumber", "itemno", "sku"]);
const qtyHeaders = ["soldqty", "qtysold", "quantitysold", "soldquantity", "salesqty", "salesquantity", "qty", "quantity"];

export function pivotReport6(buffer: Buffer): Map<string, Decimal> | null {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  for (const name of workbook.SheetNames) {
    // Formatted text preserves item codes displayed with leading zeroes.
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    for (const [index, row] of rows.entries()) {
      const headers = row.map(normalize);
      const codeCol = headers.findIndex((header) => itemHeaders.has(header));
      const qtyCol = qtyHeaders.map((header) => headers.indexOf(header)).find((column) => column >= 0);
      if (codeCol < 0 || qtyCol === undefined) continue;

      const totals = new Map<string, Decimal>();
      for (let rowIndex = index + 1; rowIndex < rows.length; rowIndex += 1) {
        const code = (rows[rowIndex][codeCol] ?? "").trim().toUpperCase();
        const value = values[rowIndex]?.[qtyCol];
        const qty = typeof value === "number" && Number.isFinite(value)
          ? new Decimal(value)
          : String(value ?? "").trim().replace(/[,\s]/g, "");
        if (!code || /^(GRAND)?TOTALS?$/.test(normalize(code).toUpperCase()) || (typeof qty === "string" && !/^-?\d*\.?\d+$/.test(qty))) continue;
        totals.set(code, (totals.get(code) ?? new Decimal(0)).add(qty));
      }
      return totals;
    }
  }
  return null;
}

export async function loadAdmReport6(store: Report6Store | null, dates: string[]) {
  return Promise.all(dates.map(async (date) => {
    if (!store) return null;
    try {
      const workbook = await openReport6File({ store, date });
      if (!workbook) return null;
      try {
        return pivotReport6(await workbook.file.readFile());
      } finally {
        await workbook.file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Could not read archived Report 6", { store, date, error });
      }
      return null;
    }
  }));
}
