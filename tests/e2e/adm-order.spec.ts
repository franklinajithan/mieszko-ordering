import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { addDaysIso, todayIso } from "../../src/utils/order-sheet-form";

test("ADM uses shop-specific Report 6 pivots, locks orders and keeps the last two quantities", async ({ request }) => {
  const db = postgres("postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable");
  const archive = path.resolve("test-results/adm-report6");
  const product = "MLEKPOL Milk 1L";
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const day10 = addDaysIso(today, -10);
  const deliveries = [1, 3, 6].map((offset) => addDaysIso(today, offset));

  function writeReport(shop: string, day: string, quantities: number[]) {
    const folder = path.join(archive, "item-sales-enquiry", "files", shop);
    mkdirSync(folder, { recursive: true });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["6. Item Sales Enquiry"], ["Item Code", "Description", "Sales Qty"],
      ...quantities.map((qty) => ["10001", "Unrelated display name", qty]),
      ["99999", product, 100], ["Grand Total", "", 1000],
    ]), "Sales");
    XLSX.writeFile(book, path.join(folder, `${day}.xlsx`));
  }

  async function load(storeId: number, deliveryDate: string) {
    const response = await request.get("/api/adm-order", { params: { storeId, deliveryDate } });
    expect(response.ok()).toBe(true);
    return (await response.json()).data;
  }

  try {
    await db`INSERT INTO suppliers (id, name, code) VALUES (991, 'ADM', 'ADM')`;
    await db`INSERT INTO supplier_products (id, product_id, supplier_id, supplier_code)
      VALUES (991, 1, 991, 'ADM-1'), (992, 2, 991, 'ADM-2')`;
    const page = await request.get("/adm-order");
    expect(page.ok()).toBe(true);
    const html = await page.text();
    expect(html).toContain("Hounslow");
    expect(html).toContain("Order History");
    expect(html).not.toContain("Import ADM workbook");
    expect((await request.post("/api/adm-order/workbook")).status()).toBe(404);

    expect((await load(1, deliveries[0])).items[0].sales[9]).toBeNull();
    writeReport("HNS", yesterday, [1.25, 2.75]);
    writeReport("PVL", yesterday, [8]);
    writeReport("HNS", day10, [0]);
    writeReport("HNS", today, [120]);

    const first = await load(1, deliveries[0]);
    expect(first.previousDates).toEqual([]);
    expect(first.items.map(({ code }: { code: string }) => code)).toEqual(["10001", "10002"]);
    expect(first.dates).toHaveLength(10);
    expect(first.missingSalesDates).toHaveLength(8);
    expect(first.items[0].sales).toEqual(["0", null, null, null, null, null, null, null, null, "4"]);

    for (const [index, qty] of [3.125, 5].entries()) {
      const data = { storeId: 1, deliveryDate: deliveries[index], quantities: { [product]: qty } };
      expect((await request.post("/api/adm-order", { data })).status()).toBe(201);
      expect((await request.post("/api/adm-order", { data })).status()).toBe(409);
      expect((await load(1, deliveries[index])).current.quantities[product]).toBe(qty);
    }
    const next = await load(1, deliveries[2]);
    expect(next.previousDates).toEqual([deliveries[1], deliveries[0]]);
    expect(next.items[0].previousQuantities).toEqual([5, 3.125]);
    expect(next.current).toBeNull();
    const otherShop = await load(2, deliveries[2]);
    expect(otherShop.previousDates).toEqual([]);
    expect(otherShop.items[0].sales[9]).toBe("8");

    const params = { storeId: 1, deliveryDate: deliveries[0] };
    const pdf = await request.get("/api/adm-order/pdf", { params });
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("ADM_Order_Hounslow_");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request.get("/api/adm-order/pdf", { params: { ...params, storeId: 2 } })).status()).toBe(404);
  } finally {
    await db`DELETE FROM adm_orders WHERE store_id = 1 AND delivery_date IN ${db(deliveries)}`;
    await db`DELETE FROM supplier_products WHERE supplier_id = 991`;
    await db`DELETE FROM suppliers WHERE id = 991`;
    rmSync(archive, { recursive: true, force: true });
    await db.end();
  }
});
