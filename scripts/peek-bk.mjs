import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("C:/Users/ShanmugaratnamMathul/Downloads/Code Source File/BK.xlsx");
const ws = wb.worksheets[0];
console.log("sheet:", ws.name);
const rows = [];
ws.eachRow((r, i) => {
  if (i <= 5) rows.push(r.values);
});
console.log(JSON.stringify(rows, null, 2));
