import { parseGloposStockValuationReport } from "../src/parsers/glopos-stock-valuation-parser";
import fs from "fs";

const path =
  "C:/Users/Ajithan/Downloads/0650_E12 6RH_Stock Valuation (Detail)_20260806_182001.xlsx";

async function main() {
  const buffer = fs.readFileSync(path);
  const result = await parseGloposStockValuationReport(buffer, path.split("/").pop()!);
  console.log("date", result.bookStockDate);
  console.log("products", result.rows.length);
  console.log("duplicateRows", result.duplicateRows);
  console.log("sourceRows", result.sourceRows);
  console.log("sample", result.rows.slice(0, 5));
  const p60298 = result.rows.filter((r) => r["Item Code"] === "P60298");
  console.log("P60298", p60298);
}

void main();
