import { expect, test } from "@playwright/test";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { parseAdmWorkbook } from "../../src/lib/adm/parse-workbook";
import { addDaysIso, todayIso } from "../../src/utils/order-sheet-form";

test("ADM uses shop-specific Daily Sales, locks orders and keeps the last two quantities", async ({ request }) => {
  const db = postgres("postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable");
  const product = "MLEKPOL Milk 1L";
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const day10 = addDaysIso(today, -10);
  const deliveries = [1, 3, 6].map((offset) => addDaysIso(today, offset));

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
    expect(html).toContain("Import shop lists from Excel");

    expect((await load(1, deliveries[0])).items[0].sales[9]).toBeNull();
    await db`INSERT INTO daily_sales (store_product_id, sales_date, sold_qty)
      VALUES (11, ${yesterday}, 4), (21, ${yesterday}, 8),
             (11, ${day10}, 0), (11, ${today}, 120)`;

    const first = await load(1, deliveries[0]);
    expect(first.previousDates).toEqual([]);
    expect(first.items.map(({ code }: { code: string }) => code)).toEqual(["10001", "10002"]);
    expect(first.dates).toHaveLength(10);
    expect(first.missingSalesDates).toHaveLength(8);
    expect(first.items[0].sales.map((qty: string | null) => qty === null ? null : Number(qty)))
      .toEqual([0, null, null, null, null, null, null, null, null, 4]);

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
    expect(Number(otherShop.items[0].sales[9])).toBe(8);

    const wednesday = await load(1, "2026-10-14");
    expect(wednesday.comparisonDates).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(wednesday.items[0].comparisonTotal).toBe("16");
    const sunday = await load(1, "2026-10-18");
    expect(sunday.comparisonDates).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(sunday.items[0].comparisonTotal).toBe("12");
    expect((await load(1, "2026-10-19")).comparisonDates).toEqual([]);

    const params = { storeId: 1, deliveryDate: deliveries[0] };
    const pdf = await request.get("/api/adm-order/pdf", { params });
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("ADM_Order_Hounslow_");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request.get("/api/adm-order/pdf", { params: { ...params, storeId: 2 } })).status()).toBe(404);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Item Code", "Product Name", "Unit"], ["10001", product, "PCS"], ["10003", "Excel vegetable", "kg"],
    ]), "HOUNSLOW");
    async function importWorkbook() {
      const bytes: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const catalogs = Object.fromEntries(parseAdmWorkbook(bytes, today));
      const upload = await request.post("/api/adm-order/workbook", { data: { catalogs } });
      expect(upload.ok()).toBe(true);
    }
    await importWorkbook();
    expect((await load(1, deliveries[2])).items.map(({ name }: { name: string }) => name)).toEqual([product, "Excel vegetable"]);
    const edit = await request.put("/api/adm-order", { data: {
      storeId: 1,
      items: { [product]: "10001", "New vegetable": "ADM-NEW" },
      addedProducts: [{ name: "New vegetable", code: "ADM-NEW" }],
    } });
    expect(edit.ok()).toBe(true);
    await importWorkbook();
    expect((await load(1, deliveries[2])).items.map(({ name }: { name: string }) => name)).toEqual([product, "New vegetable"]);
    expect((await load(2, deliveries[2])).items.map(({ name }: { name: string }) => name)).toEqual([product, "Natural Yogurt 200G"]);
    expect((await load(1, deliveries[0])).current.quantities[product]).toBe(3.125);

  } finally {
    await db`DELETE FROM adm_orders WHERE store_id = 1 AND delivery_date IN ${db(deliveries)}`;
    await db`DELETE FROM adm_shop_assortments WHERE store_id = 1`;
    await db`DELETE FROM adm_shop_catalogs WHERE store_id = 1`;
    await db`DELETE FROM supplier_products WHERE supplier_id = 991`;
    await db`DELETE FROM suppliers WHERE id = 991`;
    await db`DELETE FROM daily_sales WHERE store_product_id IN (11, 21) AND sales_date IN (${yesterday}, ${day10}, ${today})`;
    await db.end();
  }
});
