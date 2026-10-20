import { test, expect } from "@playwright/test";
import postgres from "postgres";
import ExcelJS from "exceljs";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const connection =
  "postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable";
const sql = postgres(connection, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
test.beforeEach(async () => {
  await sql.unsafe(readFileSync("tests/fixtures/seven-stores.sql", "utf8"));
});
test.afterAll(async () => {
  await sql.end();
});
async function failed(codes = ["000123"]) {
  await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,details)
 VALUES(1,'normal_sales','manual','failed','2026-10-15','2026-10-15',${sql.json({ unknown_product_codes: codes })})`;
}
test("browser: export, upload, validate, approve, refresh and audit without changing published totals", async ({
  page,
}) => {
  await failed(["000123", "000124"]);
  await page.goto("/unmatched-products");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("2 identifiers in this view", { exact: false }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel", exact: true }).click();
  const download = await downloadPromise;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const sheet = book.getWorksheet("Unmatched Products")!;
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getCell("D2").value).toBe("000123");
  sheet.getCell("G2").value = "MATCH_EXISTING";
  sheet.getCell("H2").value = "10001";
  const corrected = Buffer.from(await book.xlsx.writeBuffer());
  await page
    .getByLabel("Corrected Excel file")
    .setInputFiles({
      name: "review.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: corrected,
    });
  await expect(
    page.getByRole("heading", { name: "Preview Changes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 proposed updates · 1 pending rows · 0 rows with validation errors",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve Updates" }),
  ).toBeDisabled();
  await page.getByLabel("Operator name (self-reported)").fill("QA Operator");
  await page.getByLabel("I have reviewed these mappings").check();
  await page.getByRole("button", { name: "Approve Updates" }).click();
  await expect(
    page.getByText("1 corrections approved.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("1 identifiers in this view", { exact: false }),
  ).toBeVisible();
  expect(
    await sql`SELECT * FROM data_import_runs WHERE status='queued'`,
  ).toHaveLength(1);
  await page.getByLabel("Resolution status").selectOption("resolved");
  await expect(page.getByText("000123", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Audit History", exact: true })
    .click();
  await expect(page.getByText("QA Operator", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Upload Corrected Excel" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
test("API: preview errors block approval and cross-origin writes are rejected", async ({
  request,
}) => {
  await failed();
  expect((await request.post("/api/unmatched-products")).status()).toBe(200);
  const exported = await request.get("/api/unmatched-products/export");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await exported.body()) as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0];
  sheet.getCell("G2").value = "MATCH_EXISTING";
  sheet.getCell("H2").value = "OTHER_STORE_CODE";
  const preview = await request.post("/api/unmatched-products/preview", {
    multipart: {
      file: {
        name: "review.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await book.xlsx.writeBuffer()),
      },
    },
  });
  expect(preview.status()).toBe(200);
  const data = (await preview.json()).data;
  expect(data.summary.errors).toBe(1);
  const approve = await request.post("/api/unmatched-products/approve", {
    data: { batchId: data.id, operator: "Test", confirm: true },
  });
  expect(approve.status()).toBe(400);
  expect(
    (
      await request.post("/api/unmatched-products", {
        headers: { Origin: "https://other.example" },
      })
    ).status(),
  ).toBe(403);
  expect(await sql`SELECT * FROM crm_product_code_aliases`).toHaveLength(0);
});
test("API: existing Product Upload automatically resolves pending identifiers", async ({
  request,
}) => {
  await failed();
  await request.post("/api/unmatched-products");
  const response = await request.post("/api/products/import", {
    data: {
      storeId: 1,
      codeColumn: "Code",
      nameColumn: "Name",
      departmentColumn: "Department",
      barcodeColumn: "Barcode",
      rows: [
        {
          Code: "000123",
          Name: "Verified new product",
          Department: "Dairy",
          Barcode: "000012300",
        },
      ],
    },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data.matchedRows).toBe(1);
  const pending = (await (await request.get("/api/unmatched-products")).json())
    .data;
  expect(pending.total).toBe(0);
  expect(
    await sql`SELECT * FROM data_import_runs WHERE status='queued'`,
  ).toHaveLength(1);
});
test("worker: reconcile a retained complete report through approval without downloading again or duplicating totals", async ({
  request,
}) => {
  const folder = mkdtempSync(path.join(tmpdir(), "reconciliation-worker-"));
  const config = path.join(folder, "config.json");
  const entry = {
    download_directory: path.join(folder, "downloads"),
    app_directory: process.cwd(),
    stores: {
      "1": {
        erp: "msp",
        feeds: {
          normal_sales: {
            extension: ".xlsx",
            mapping: { code: "Item Code", quantity: "Quantity" },
            complete_store_report: true,
            normalize_with_app_parsers: true,
            command: [
              "python",
              "tests/support/fixture-crm.py",
              "--output",
              "{output}",
              "--source",
              "{source}",
              "--start",
              "{start}",
              "--store",
              "{store_id}",
              "--unknown",
            ],
          },
        },
      },
    },
  };
  writeFileSync(config, JSON.stringify(entry));
  await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date) VALUES(1,'normal_sales','manual','2026-10-07','2026-10-07')`;
  const run = () =>
    execFileSync(
      "python",
      ["automation/worker.py", "--config", config, "--once"],
      {
        env: { ...process.env, DATABASE_URL: connection },
        encoding: "utf8",
        timeout: 60000,
      },
    );
  run();
  const [failedRun] = await sql`SELECT * FROM data_import_runs`;
  expect(failedRun.status).toBe("failed");
  expect(await sql`SELECT * FROM crm_report_stage`).not.toHaveLength(0);
  expect(
    Number(
      (
        await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`
      )[0].sold_qty,
    ),
  ).toBe(4);
  await request.post("/api/unmatched-products");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await (
      await request.get("/api/unmatched-products/export")
    ).body()) as unknown as ExcelJS.Buffer,
  );
  const sheet = book.worksheets[0];
  sheet.getCell("G2").value = "MATCH_EXISTING";
  sheet.getCell("H2").value = "10001";
  const preview = await request.post("/api/unmatched-products/preview", {
    multipart: {
      file: {
        name: "review.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await book.xlsx.writeBuffer()),
      },
    },
  });
  const batch = (await preview.json()).data;
  expect(batch.summary.errors).toBe(0);
  expect(
    (
      await request.post("/api/unmatched-products/approve", {
        data: { batchId: batch.id, operator: "QA", confirm: true },
      })
    ).status(),
  ).toBe(200);
  entry.stores["1"].feeds.normal_sales.command = [
    "python",
    "-c",
    'raise RuntimeError("Downloader must not run")',
  ];
  writeFileSync(config, JSON.stringify(entry));
  const quality = await request.get('/api/data-quality?storeId=1&type=unknown_product_code');
  expect((await quality.json()).data.total).toBe(0);
  expect(run()).toContain("success (retained validated report)");
  const [retry] =
    await sql`SELECT * FROM data_import_runs ORDER BY id DESC LIMIT 1`;
  expect(retry.status).toBe("success");
  expect(retry.details.reused_stage_of).toBe(Number(failedRun.id));
  await request.post("/api/unmatched-products");
  expect(await sql`SELECT * FROM data_import_runs`).toHaveLength(2);
  expect(
    await sql`SELECT * FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`,
  ).toHaveLength(1);
});
