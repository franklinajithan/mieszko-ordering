import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";
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
const tables = {
  normal_sales: ["daily_sales", "sales_date", "sold_qty"],
  rtc: ["rtc_sales", "rtc_date", "rtc_qty"],
  wastage: ["wastage", "wastage_date", "wastage_qty"],
} as const;
type Feed = keyof typeof tables;
async function attempt(
  source: Feed,
  day = "2026-10-15",
  rows = [
    ["10001", "4"],
    ["UNKNOWN-1", "2"],
    ["UNKNOWN-2", "3"],
  ],
  mapping = "store_product_code",
) {
  const [run] =
    await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) VALUES(1,${source},'manual','downloaded',${day},${day}) RETURNING id`;
  const script = `import sys,json,os\nfrom datetime import date\nfrom decimal import Decimal\nimport psycopg\nfrom automation.worker import stage_report,import_report\na=json.loads(sys.argv[1])\njob=(a['id'],1,a['source'],a['day'],a['day'])\nrows={(code,date.fromisoformat(a['day'])):Decimal(qty) for code,qty in a['rows']}\nwith psycopg.connect(os.environ['DATABASE_URL'],autocommit=True,prepare_threshold=None,cursor_factory=psycopg.ClientCursor) as conn:\n stage_report(conn,job,rows,a['mapping'],'verified-test-source')\n print(json.dumps(import_report(conn,job,rows,'fixture.xlsx',a['mapping'],'verified-test-source')))\n`;
  const output = execFileSync(
    "python",
    [
      "-c",
      script,
      JSON.stringify({ id: Number(run.id), source, day, rows, mapping }),
    ],
    {
      env: { ...process.env, DATABASE_URL: connection },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  return { id: Number(run.id), result: JSON.parse(output) };
}
async function quantities(source: Feed, day = "2026-10-15") {
  const [table, date, qty] = tables[source];
  return sql.unsafe(
    `SELECT store_product_id,${qty}::text AS quantity FROM ${table} WHERE ${date}=$1 ORDER BY store_product_id`,
    [day],
  );
}
for (const source of Object.keys(tables) as Feed[])
  test(`${source}: save matched rows now and finalize retained unresolved rows without duplicate quantities`, async ({
    request,
    page,
  }) => {
    const first = await attempt(source);
    expect(first.result).toMatchObject({ status: "partial", saved: 1 });
    expect(await quantities(source)).toEqual([
      { store_product_id: 11, quantity: "4.0000" },
    ]);
    const [audit] =
      await sql`SELECT * FROM data_import_runs WHERE id=${first.id}`;
    expect(audit.status).toBe("success");
    expect(audit.details.partial_import).toBe(true);
    expect(audit.imported_row_count).toBe(1);
    expect(audit.rejected_row_count).toBe(2);
    expect(
      await sql`SELECT * FROM crm_report_stage WHERE run_id=${first.id}`,
    ).toHaveLength(3);
    await request.post("/api/unmatched-products");
    expect(
      await sql`SELECT * FROM data_import_runs WHERE status='queued'`,
    ).toHaveLength(0);
    await page.goto("/downloads");
    await page
      .getByRole("button", { name: "Partial / needs review", exact: false })
      .click();
    await expect(
      page.getByText("Partial — unmatched products pending"),
    ).toBeVisible();
    await page.goto("/");
    await expect(
      page.getByText("partial reports in these totals:", { exact: false }),
    ).toBeVisible();
    const coverage = await request.post("/api/order-sheet/preflight", {
      data: {
        storeIds: [1],
        supplierIds: [1],
        comparisonPeriods: [{ startDate: "2026-10-15", endDate: "2026-10-15" }],
        includeRtc: true,
        includeWastage: true,
        includeBookStock: false,
      },
    });
    const ready = (await coverage.json()).data;
    expect(
      ready.warnings.some((text: string) =>
        text.includes("partial store/date"),
      ),
    ).toBe(true);
    const feedCoverage = ready.feedCoverage.find(
      (feed: { source: string }) => feed.source === source,
    );
    expect(feedCoverage.availableStoreDays).toBe(1);
    async function correct(identifier: string, target: string) {
      const response = await request.get(
        "/api/unmatched-products/export?storeId=1",
      );
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(
        (await response.body()) as unknown as ExcelJS.Buffer,
      );
      const sheet = book.worksheets[0];
      sheet.eachRow((row, n) => {
        if (n > 1 && row.getCell(4).value === identifier) {
          row.getCell(7).value = "MATCH_EXISTING";
          row.getCell(8).value = target;
        }
      });
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
      const approve = await request.post("/api/unmatched-products/approve", {
        data: { batchId: batch.id, operator: "QA", confirm: true },
      });
      expect(approve.status()).toBe(200);
      expect((await approve.json()).data.queued).toBe(1);
    }
    const folder = mkdtempSync(path.join(tmpdir(), "partial-worker-"));
    const config = path.join(folder, "config.json");
    writeFileSync(
      config,
      JSON.stringify({
        download_directory: path.join(folder, "downloads"),
        stores: {
          "1": {
            feeds: {
              [source]: {
                complete_store_report: true,
                command: [
                  "python",
                  "-c",
                  'raise RuntimeError("must reuse stage")',
                ],
              },
            },
          },
        },
      }),
    );
    const run = () =>
      execFileSync(
        "python",
        ["automation/worker.py", "--config", config, "--once"],
        {
          env: { ...process.env, DATABASE_URL: connection },
          encoding: "utf8",
          timeout: 15000,
        },
      );
    await correct("UNKNOWN-1", "10002");
    expect(run()).toContain("partial (retained validated report)");
    expect(await quantities(source)).toEqual([
      { store_product_id: 11, quantity: "4.0000" },
      { store_product_id: 12, quantity: "2.0000" },
    ]);
    await request.post("/api/unmatched-products");
    expect(
      await sql`SELECT * FROM data_import_runs WHERE status='queued'`,
    ).toHaveLength(0);
    await correct("UNKNOWN-2", "10001");
    expect(run()).toContain("success (retained validated report)");
    expect(await quantities(source)).toEqual([
      { store_product_id: 11, quantity: "7.0000" },
      { store_product_id: 12, quantity: "2.0000" },
    ]);
    expect(await sql`SELECT * FROM crm_partial_publications`).toHaveLength(0);
    const [latest] =
      await sql`SELECT * FROM data_import_runs ORDER BY id DESC LIMIT 1`;
    expect(latest.status).toBe("success");
    expect(
      await sql`SELECT * FROM crm_report_stage WHERE run_id=${latest.id}`,
    ).toHaveLength(0);
    await request.post("/api/unmatched-products");
    expect((await (await request.get('/api/data-quality?storeId=1&type=import_failure')).json()).data.total).toBe(0);
  expect(await sql`SELECT * FROM data_import_runs`).toHaveLength(3);
  });
test("partial retry protects prior complete data and manual edits", async () => {
  const before = await quantities("normal_sales", "2026-10-07");
  const protectedAttempt = await attempt("normal_sales", "2026-10-07");
  expect(protectedAttempt.result.saved).toBe(0);
  expect(protectedAttempt.result.details.protected_complete_dates).toEqual([
    "2026-10-07",
  ]);
  expect(await quantities("normal_sales", "2026-10-07")).toEqual(before);
  await attempt("normal_sales");
  await sql`UPDATE daily_sales SET sold_qty=99 WHERE store_product_id=11 AND sales_date='2026-10-15'`;
  const next = await attempt("normal_sales");
  expect(next.result.saved).toBe(0);
  expect(await quantities("normal_sales")).toEqual([
    { store_product_id: 11, quantity: "99.0000" },
  ]);
});
test("identical partial retries replace subtotals instead of accumulating and isolate stores/feeds", async () => {
  await attempt("normal_sales");
  await attempt("normal_sales");
  expect(await quantities("normal_sales")).toEqual([
    { store_product_id: 11, quantity: "4.0000" },
  ]);
  expect(await quantities("rtc")).toHaveLength(0);
  expect(await quantities("wastage")).toHaveLength(0);
  expect(
    await sql`SELECT * FROM daily_sales d JOIN store_products s ON s.id=d.store_product_id WHERE s.store_id=2 AND sales_date='2026-10-15'`,
  ).toHaveLength(0);
});
test("barcode reports save matches while unknown barcodes remain pending", async () => {
  const result = await attempt(
    "rtc",
    "2026-10-15",
    [
      ["5901234560001", "1.25"],
      ["000099999", "2.5"],
    ],
    "barcode",
  );
  expect(result.result.status).toBe("partial");
  expect(await quantities("rtc")).toEqual([
    { store_product_id: 11, quantity: "1.2500" },
  ]);
  expect(result.result.details.unmatched_barcodes).toEqual(["000099999"]);
  const [review] = await sql`SELECT i.identifier,i.kind,o.run_id FROM crm_product_identifiers i
    JOIN crm_identifier_occurrences o ON o.identifier_id=i.id WHERE i.identifier='000099999'`;
  expect(review).toMatchObject({identifier:"000099999",kind:"Barcode"});
  expect(Number(review.run_id)).toBe(result.id);
});
test("partial write failure rolls back quantities, ownership and the terminal audit", async () => {
  await sql.unsafe(
    "CREATE OR REPLACE FUNCTION fixture_partial_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected failure'; END $$; CREATE TRIGGER fixture_partial_failure BEFORE INSERT ON crm_partial_publications FOR EACH ROW EXECUTE FUNCTION fixture_partial_failure();",
  );
  try {
    await expect(attempt("normal_sales")).rejects.toThrow();
    expect(await quantities("normal_sales")).toHaveLength(0);
    expect(await sql`SELECT * FROM crm_partial_publications`).toHaveLength(0);
    expect((await sql`SELECT status FROM data_import_runs`)[0].status).toBe(
      "importing",
    );
  } finally {
    await sql.unsafe(
      "DROP TRIGGER fixture_partial_failure ON crm_partial_publications;DROP FUNCTION fixture_partial_failure()",
    );
  }
});

test("a previous verified zero report is protected and the ownership migration is repeatable", async () => {
  await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_row_count) VALUES(1,'normal_sales','manual','success','2026-10-15','2026-10-15',0)`;
  const run = await attempt("normal_sales");
  expect(run.result.saved).toBe(0);
  expect(run.result.details.protected_complete_dates).toEqual(["2026-10-15"]);
  expect(await quantities("normal_sales")).toHaveLength(0);
  await attempt("rtc");
  await sql.unsafe(
    readFileSync(
      "migrations/manual/2026-10-20-partial-crm-imports.sql",
      "utf8",
    ),
  );
  expect(await sql`SELECT * FROM crm_partial_publications`).toHaveLength(1);
});
test("refresh upgrades a legacy staged failure once to publish matching rows without waiting for corrections", async ({
  request,
}) => {
  const first = await attempt("normal_sales");
  await sql`DELETE FROM daily_sales WHERE sales_date='2026-10-15'`;
  await sql`DELETE FROM crm_partial_publications`;
  await sql`UPDATE data_import_runs SET status='failed',imported_at=NULL,imported_row_count=0,details=details-'partial_import_version'-'partial_import'-'has_unmatched_products' WHERE id=${first.id}`;
  const refresh = await request.post("/api/unmatched-products");
  expect((await refresh.json()).data.queued).toBe(1);
  const folder = mkdtempSync(path.join(tmpdir(), "legacy-partial-"));
  const config = path.join(folder, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      download_directory: folder,
      stores: {
        "1": {
          feeds: {
            normal_sales: {
              complete_store_report: true,
              command: [
                "python",
                "-c",
                'raise RuntimeError("must reuse stage")',
              ],
            },
          },
        },
      },
    }),
  );
  const output = execFileSync(
    "python",
    ["automation/worker.py", "--config", config, "--once"],
    {
      env: { ...process.env, DATABASE_URL: connection },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  expect(output).toContain("partial (retained validated report)");
  expect(await quantities("normal_sales")).toEqual([
    { store_product_id: 11, quantity: "4.0000" },
  ]);
  expect(
    (await (await request.post("/api/unmatched-products")).json()).data.queued,
  ).toBe(0);
});
