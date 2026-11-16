import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWastageFileBuffer } from "./wastage-file-parser";

describe("MSP Wastage empty report validation", () => {
  it.each(["xls", "xlsx", "XLS"])("accepts a recognized No Records Available %s report as zero wastage", async (extension) => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["", "", "", "", "Wastage"],
      ["Mieszko Hayes - Date Range: 15-10-2026 to 15-10-2026"],
      ["No Records Available"],
    ]);
    XLSX.utils.book_append_sheet(book, sheet, "Wastage");
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
    await expect(parseWastageFileBuffer(bytes, `Hayes_Wastage_20261015.${extension}`, "msp"))
      .resolves.toMatchObject({rows:[],emptyReport:true,wastageDate:"2026-10-15"});
  });
  it("still rejects an empty message belonging to an unrelated report",async()=>{
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Sales"],["No Records Available"]]),"Sales");
    await expect(parseWastageFileBuffer(XLSX.write(book,{type:"buffer",bookType:"xlsx"}),"report.xlsx","msp")).rejects.toThrow("recognized Wastage report");
  });
});

function workbook(rows:unknown[][],type:'xls'|'xlsx'='xlsx') {
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Report');
 return XLSX.write(book,{type:'buffer',bookType:type==='xls'?'biff8':'xlsx'}) as Buffer;
}
for(const extension of ['xls','xlsx'] as const) {
 it(`reads real ${extension} bytes with an empty marker`,async()=>{
  expect(await parseWastageFileBuffer(workbook([['Wastage'],['No Records Available']],extension),`report.${extension}`)).toMatchObject({emptyReport:true,rows:[]});
 });
 it(`reads a header-only ${extension} with metadata`,async()=>{
  expect(await parseWastageFileBuffer(workbook([['Stock Adjustment'],['Date Range: 15-10-2026 to 15-10-2026'],['Item Code','Qty']],extension),`report.${extension}`)).toMatchObject({emptyReport:true,wastageDate:'2026-10-15'});
 });
}
it('rejects wrong store, wrong day and impossible dates even without transactions',async()=>{
 const buffer=workbook([['Mieszko Hayes Wastage'],['Date Range: 15-10-2026 to 15-10-2026'],['No Records Available']]);
 await expect(parseWastageFileBuffer(buffer,'report.xlsx','msp',{storeName:'Hounslow',storeNames:['Hayes','Hounslow']})).rejects.toThrow('another store');
 await expect(parseWastageFileBuffer(buffer,'report.xlsx','msp',{date:'2026-10-14'})).rejects.toThrow('date differs');
 await expect(parseWastageFileBuffer(workbook([['Wastage'],['Date: 31-02-2026'],['No Records Available']]),'report.xlsx')).rejects.toThrow('valid day');
});
it.each([Buffer.from('unreadable report'),Buffer.from('<html><form>Password No Records Available Wastage</form></html>'),Buffer.alloc(0)])('rejects unreadable or login content',async buffer=>{
 await expect(parseWastageFileBuffer(buffer,'report.xlsx')).rejects.toThrow();
});
it.each(['Normal Sales','Price Override','Book Stock','Supplier Prices'])('rejects an unrelated header-only %s report',async title=>{
 await expect(parseWastageFileBuffer(workbook([[title],['Item Code','Qty']]),'report.xlsx')).rejects.toThrow();
});
it('does not discard malformed product rows as zero wastage',async()=>{
 const buffer=workbook([['Stock Adjustment'],['Item Code','Qty'],['10001','broken']]);
 // The worker/manual preparation must reject the retained malformed quantity.
 const result=await parseWastageFileBuffer(buffer,'report.xlsx');
 expect(result.emptyReport).not.toBe(true);
});
it('accepts a zero total footer without using the printed date as the business date',async()=>{
 const result=await parseWastageFileBuffer(workbook([['Wastage'],['Item Code','Qty'],['Grand Total',0],['Printed: 21-10-2026']]),'report.xlsx','msp',{date:'2026-10-15'});
 expect(result).toMatchObject({emptyReport:true,rows:[]});expect(result.wastageDate).toBeUndefined();
});
it('accepts CSV empty reports and rejects a Sales report with generic quantity headers',async()=>{
 expect(await parseWastageFileBuffer(Buffer.from('Wastage\nNo Records Available\n'),'report.csv')).toMatchObject({emptyReport:true});
 await expect(parseWastageFileBuffer(workbook([['Sales'],['Item Code','Qty']]),'report.xlsx')).rejects.toThrow('recognized Wastage report');
});
it('validates explicit CRM store codes on empty reports',async()=>{
 const buffer=workbook([['Wastage'],['Store Code: 0665'],['No Records Available']]);
 await expect(parseWastageFileBuffer(buffer,'report.xlsx','msp',{storeCode:'HNS'})).rejects.toThrow('another store');
 expect(await parseWastageFileBuffer(buffer,'report.xlsx','msp',{storeCode:'HYS'})).toMatchObject({emptyReport:true});
});
it('validates store metadata without mistaking a product description for a store marker',async()=>{
 const parsed=await parseWastageFileBuffer(workbook([['Hounslow Wastage'],['Item Code','Item Name','Qty'],['10001','Hayes Bread',2]]),'report.xlsx','msp',{storeName:'Hounslow',storeNames:['Hayes','Hounslow']});
 expect(parsed.rows).toHaveLength(1);
});
it('retains valid Unicode product identifiers for matching and review',async()=>{
 const parsed=await parseWastageFileBuffer(workbook([['Item Code','Qty'],['ŻÓŁĆ-WASTE',3]]),'report.xlsx');
 expect(parsed.rows).toHaveLength(1);expect(parsed.rows[0][parsed.referenceColumn!]).toBe('ŻÓŁĆ-WASTE');
});
