import ExcelJS from "exceljs";

async function main() {
  const path = "C:/Users/Ajithan/Downloads/0650_E12 6RH_Wastage_20260730_165738.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  console.log(
    "sheets",
    wb.worksheets.map((s) => s.name),
  );
  const sheet =
    wb.worksheets.find((s) => /wastagereport/i.test(s.name.replace(/\s+/g, ""))) ??
    wb.worksheets[0]!;
  for (let r = 1; r <= 35; r++) {
    const row = sheet.getRow(r);
    const vals: string[] = [];
    row.eachCell({ includeEmpty: false }, (c, i) => {
      vals[i - 1] = String(c.text || c.value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
    });
    const line = vals.join(" | ");
    if (
      line.toLowerCase().includes("product code") ||
      line.toLowerCase().startsWith("reason") ||
      r < 15
    ) {
      console.log(r, line.slice(0, 220));
    }
  }
}

void main();
