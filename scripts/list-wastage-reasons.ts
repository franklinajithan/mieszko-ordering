import fs from "node:fs";
import ExcelJS from "exceljs";

import { parseGloposWastageReport } from "../src/parsers/glopos-wastage-report-parser";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("").trim();
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text?: string }).text ?? "").trim();
  }
  if (typeof value === "object" && "result" in value) {
    return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

async function main() {
  const path = "C:/Users/Ajithan/Downloads/0650_E12 6RH_Wastage_20260730_165738.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.worksheets[0]!;
  let headerRow = 0;
  for (let r = 1; r <= 80; r++) {
    const row = sheet.getRow(r);
    let found = false;
    row.eachCell({ includeEmpty: false }, (c) => {
      if (cellText(c.value).toLowerCase() === "product code") found = true;
    });
    if (found) {
      headerRow = r;
      break;
    }
  }
  console.log("headerRow", headerRow);
  for (let r = 11; r <= 80; r++) {
    const pc = cellText(sheet.getRow(r).getCell(2).value);
    if (/reason|total for|transfer/i.test(pc)) console.log(r, pc.slice(0, 100));
  }
}

void main();
