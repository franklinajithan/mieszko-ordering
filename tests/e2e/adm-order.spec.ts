import { expect, test } from "@playwright/test";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { addDaysIso, todayIso } from "../../src/utils/order-sheet-form";

test("ADM sales and submitted quantities are scoped to each shop", async ({ request }) => {
  const db = postgres("postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable");
  const product = "TEST BEETROOT";
  const carrot = "TEST CARROT";
  const today = todayIso();
  const firstDate = addDaysIso(today, 1);
  const nextDate = addDaysIso(today, 3);

  async function load(storeId: number, deliveryDate: string) {
    const response = await request.get("/api/adm-order", { params: { storeId, deliveryDate } });
    expect(response.ok()).toBe(true);
    return (await response.json()).data;
  }

  try {
    await db`INSERT INTO store_products (id, store_id, product_id, store_product_code)
      VALUES (991, 1, 1, 'ADM-TEST-01'), (992, 2, 1, 'ADM-TEST-01')`;
    await db`INSERT INTO daily_sales (store_product_id, sales_date, sold_qty)
      VALUES (991, ${addDaysIso(today, -1)}, 2.5), (992, ${addDaysIso(today, -1)}, 99),
             (991, ${addDaysIso(today, -10)}, 0), (991, ${addDaysIso(today, -11)}, 70),
             (991, ${today}, 50)`;

    const workbook = XLSX.utils.book_new();
    for (const shop of ["HOUNSLOW", "PERIVALE"]) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["Item Code", "Product Name", "Unit", addDaysIso(today, -1), nextDate],
        ["ADM-TEST-01", product, "KG", 7, 81],
        ["ADM-TEST-02", carrot, "PCS", 2, 82],
      ]), shop);
    }
    const upload = await request.post("/api/adm-order/workbook", {
      multipart: {
        workbook: {
          name: "adm-test.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
        },
      },
    });
    expect(await upload.json()).toMatchObject({ success: true, data: { imported: ["Hounslow", "Perivale"] } });
    const page = await request.get("/adm-order");
    expect(page.ok()).toBe(true);
    expect(await page.text()).toContain("Import ADM workbook");

    const first = await load(1, firstDate);
    expect(first.previousDate).toBe(addDaysIso(today, -1));
    expect(first.items[0].previousQty).toBe(7);
    expect(first.dates).toHaveLength(10);
    expect(first.items[0].sales.map((qty: string | null) => qty === null ? null : Number(qty)))
      .toEqual([0, null, null, null, null, null, null, null, null, 2.5]);

    const assortment = await request.put("/api/adm-order", {
      data: { storeId: 1, items: { [product]: "ADM-TEST-01" } },
    });
    expect(assortment.ok()).toBe(true);
    expect((await load(1, firstDate)).items).toHaveLength(1);
    const hiddenItem = await request.post("/api/adm-order", {
      data: { storeId: 1, deliveryDate: firstDate, quantities: { [carrot]: 3 } },
    });
    expect(hiddenItem.status()).toBe(409);
    const data = { storeId: 1, deliveryDate: firstDate, quantities: { [product]: 3.125 } };
    expect((await request.post("/api/adm-order", { data })).status()).toBe(201);
    expect((await request.post("/api/adm-order", { data })).status()).toBe(409);
    expect((await load(1, firstDate)).current.quantities[product]).toBe(3.125);

    const next = await load(1, nextDate);
    expect(next.previousDate).toBe(firstDate);
    expect(next.items[0].previousQty).toBe(3.125);
    expect(next.current).toBeNull();

    const otherShop = await load(2, nextDate);
    expect(otherShop.items).toHaveLength(2);
    expect(otherShop.items[0].previousQty).toBe(7);
    expect(Number(otherShop.items[0].sales[9])).toBe(99);
  } finally {
    await db`DELETE FROM adm_orders WHERE store_id = 1 AND delivery_date = ${firstDate}`;
    await db`DELETE FROM adm_shop_assortments WHERE store_id = 1`;
    await db`DELETE FROM adm_shop_catalogs WHERE store_id IN (1, 2)`;
    await db`DELETE FROM daily_sales WHERE store_product_id IN (991, 992)`;
    await db`DELETE FROM store_products WHERE id IN (991, 992)`;
    await db.end();
  }
});
