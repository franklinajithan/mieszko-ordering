import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { addDaysIso, todayIso } from "../../src/utils/order-sheet-form";

test("ADM sales and submitted quantities are scoped to each shop", async ({ request }) => {
  const connection = "postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable";
  const db = postgres(connection);
  const folder = mkdtempSync(path.join(tmpdir(), "adm-sales-worker-"));
  const runIds: string[] = [];
  const product = "TEST BEETROOT";
  const carrot = "TEST CARROT";
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const firstDate = addDaysIso(today, 1);
  const nextDate = addDaysIso(today, 3);

  async function load(storeId: number, deliveryDate: string) {
    const response = await request.get("/api/adm-order", { params: { storeId, deliveryDate } });
    expect(response.ok()).toBe(true);
    return (await response.json()).data;
  }

  try {
    // The report fixture exports two 10001 rows for the same shop and date.
    await db`INSERT INTO crm_product_code_aliases (store_id, identifier, store_product_id)
      VALUES (1, 'ADM-TEST-01', 11)`;
    await db`INSERT INTO daily_sales (store_product_id, sales_date, sold_qty)
      VALUES (11, ${addDaysIso(today, -10)}, 0), (11, ${addDaysIso(today, -11)}, 70), (11, ${today}, 50)`;
    await db`INSERT INTO product_barcodes (store_id, store_product_id, barcode) VALUES (2, 21, '8000000000010')`;

    const workbook = XLSX.utils.book_new();
    for (const shop of ["HOUNSLOW", "PERIVALE"]) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["Item Code", "EAN", "Product Name", "Unit", yesterday, nextDate],
        [shop === "HOUNSLOW" ? "ADM-TEST-01" : null, "8000000000010", product, "KG", 7, 81],
        ["ADM-TEST-02", null, carrot, "PCS", 2, 82],
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

    expect((await load(1, firstDate)).items[0].sales[9]).toBeNull();
    const config = path.join(folder, "config.json");
    const feed = {
      command: ["python", "tests/support/fixture-crm.py", "--output", "{output}", "--source", "{source}", "--start", "{start}", "--store", "{store_id}"],
      extension: ".xlsx",
      mapping: { code: "Item Code", quantity: "Quantity" },
      complete_store_report: true,
      normalize_with_app_parsers: true,
    };
    writeFileSync(config, JSON.stringify({
      download_directory: path.join(folder, "downloads"),
      app_directory: process.cwd(),
      stores: { 1: { erp: "msp", feeds: { normal_sales: feed } }, 2: { erp: "msp", feeds: { normal_sales: feed } } },
    }));
    const runs = await db`INSERT INTO data_import_runs (store_id, source_type, source_start_date, source_end_date, trigger_type)
      VALUES (1, 'normal_sales', ${yesterday}, ${yesterday}, 'nightly'),
             (2, 'normal_sales', ${yesterday}, ${yesterday}, 'nightly') RETURNING id`;
    runIds.push(...runs.map((run) => run.id));
    execFileSync("python", ["automation/worker.py", "--config", config, "--once"], {
      env: { ...process.env, DATABASE_URL: connection },
      timeout: 30000,
    });
    const completed = await db`SELECT status FROM data_import_runs WHERE id IN ${db(runIds)}`;
    expect(completed.map(({ status }) => status)).toEqual(["success", "success"]);

    const first = await load(1, firstDate);
    expect(first.previousDate).toBe(yesterday);
    expect(first.items[0].code).toBe("ADM-TEST-01");
    expect(first.items[0].previousQty).toBe(7);
    expect(first.dates).toHaveLength(10);
    expect(first.items[0].sales.map((qty: string | null) => qty === null ? null : Number(qty)))
      .toEqual([0, null, null, null, null, null, null, null, null, 4]);

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
    expect(otherShop.items[0].code).toBe("10001");
    expect(Number(otherShop.items[0].sales[9])).toBe(8);
  } finally {
    await db`DELETE FROM adm_orders WHERE store_id = 1 AND delivery_date = ${firstDate}`;
    await db`DELETE FROM adm_shop_assortments WHERE store_id = 1`;
    await db`DELETE FROM adm_shop_catalogs WHERE store_id IN (1, 2)`;
    if (runIds.length) {
      await db`DELETE FROM crm_report_stage WHERE run_id IN ${db(runIds)}`;
      await db`DELETE FROM data_import_runs WHERE id IN ${db(runIds)}`;
    }
    await db`DELETE FROM daily_sales WHERE (store_product_id = 11 AND sales_date IN
      (${addDaysIso(today, -11)}, ${addDaysIso(today, -10)}, ${yesterday}, ${today}))
      OR (store_product_id = 21 AND sales_date = ${yesterday})`;
    await db`DELETE FROM crm_product_code_aliases WHERE store_id = 1 AND identifier = 'ADM-TEST-01'`;
    await db`DELETE FROM product_barcodes WHERE store_id = 2 AND barcode = '8000000000010'`;
    rmSync(folder, { recursive: true, force: true });
    await db.end();
  }
});
