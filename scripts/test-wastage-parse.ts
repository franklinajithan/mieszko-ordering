import fs from "node:fs";
import { parseGloposWastageReport } from "../src/parsers/glopos-wastage-report-parser";

async function main() {
  const path = "C:/Users/Ajithan/Downloads/0650_E12 6RH_Wastage_20260730_165738.xlsx";
  const buffer = fs.readFileSync(path);
  const result = await parseGloposWastageReport(
    buffer,
    "0650_E12 6RH_Wastage_20260730_165738.xlsx",
  );
  console.log({
    wastageDate: result.wastageDate,
    sourceRows: result.sourceRows,
    uniqueProducts: result.rows.length,
    duplicateRows: result.duplicateRows,
    skippedExcludedReasonRows: result.skippedExcludedReasonRows,
    sample: result.rows.slice(0, 3),
  });
}

void main();
