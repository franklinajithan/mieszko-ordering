import ExcelJS from "exceljs";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) {
    return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

async function main() {
  const path =
    "C:/Users/Ajithan/Downloads/0650_E12 6RH_Stock Valuation (Detail)_20260806_182001.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  console.log(
    "sheets",
    wb.worksheets.map((s) => s.name),
  );
  const sheet = wb.worksheets[0]!;
  for (let r = 1; r <= 25; r++) {
    const vals: string[] = [];
    sheet.getRow(r).eachCell({ includeEmpty: false }, (c, i) => {
      vals[i - 1] = cellText(c.value).slice(0, 40);
    });
    const line = vals.join(" | ");
    if (/item|stock|code|header|r < 12/i.test(line) || r < 15) {
      console.log(r, line.slice(0, 200));
    }
  }
}

void main();
