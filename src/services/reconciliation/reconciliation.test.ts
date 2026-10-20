import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  buildReviewWorkbook,
  readCorrections,
  type Correction,
} from "./workbook";
vi.mock("server-only", () => ({}));
const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return context.db;
  },
}));
const client = new PGlite();
const pg = drizzle(client);
function adapt(database: typeof pg): typeof pg {
  return new Proxy(database, {
    get(target, prop) {
      if (prop === "execute")
        return async (...args: Parameters<typeof pg.execute>) =>
          (await target.execute(...args)).rows;
      if (prop === "transaction")
        return (callback: (tx: typeof pg) => Promise<unknown>) =>
          target.transaction((tx) =>
            callback(adapt(tx as unknown as typeof pg)),
          );
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
context.db = adapt(pg);
const service = await import("./reconciliation.service");
beforeAll(async () => {
  await client.exec(readFileSync("schema.sql", "utf8"));
  for (const name of [
    "2026-10-15-data-import-runs.sql",
    "2026-10-20-unmatched-products.sql",
  ])
    await client.exec(readFileSync("migrations/manual/" + name, "utf8"));
}, 30000);
beforeEach(async () => {
  await client.exec(readFileSync("tests/fixtures/seven-stores.sql", "utf8"));
});
afterAll(async () => {
  await client.close();
});
async function failure(
  identifiers = ["000123"],
  kind = "Product code",
  feed = "normal_sales",
  date = "2026-10-15",
  store = 1,
) {
  const details = JSON.stringify({
    [kind === "Barcode" ? "unmatched_barcodes" : "unknown_product_codes"]:
      identifiers,
  });
  await client.query(
    "INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,details) VALUES($1,$2,'manual','failed',$3,$3,$4::jsonb)",
    [store, feed, date, details],
  );
}
function correction(extra: Partial<Correction> = {}): Correction {
  return {
    rowNumber: 2,
    storeId: 1,
    kind: "Product code",
    identifier: "000123",
    action: "MATCH_EXISTING",
    existingCode: "10001",
    newCode: "",
    productName: "",
    department: "",
    barcode: "",
    supplierCode: "",
    notes: "Verified against product master",
    ...extra,
  };
}
async function approve(rows: Correction[]) {
  const preview = await service.previewCorrections(rows);
  expect(preview.summary.errors).toBe(0);
  return service.approveCorrections(preview.id, "Test operator");
}
describe("persistent reconciliation", () => {
  it("keeps approved mappings and audit when the migration is reapplied", async () => {
    await failure();
    await service.refreshReconciliation();
    await approve([correction()]);
    await client.exec(
      readFileSync(
        "migrations/manual/2026-10-20-unmatched-products.sql",
        "utf8",
      ),
    );
    expect(
      (await client.query("SELECT * FROM crm_product_code_aliases")).rows,
    ).toHaveLength(1);
    expect(
      (await client.query("SELECT * FROM crm_reconciliation_audit")).rows,
    ).toHaveLength(1);
    await expect(
      client.exec(
        "INSERT INTO store_products(store_id,product_id,store_product_code) VALUES(1,2,'000123')",
      ),
    ).rejects.toThrow("approved CRM alias");
  });
  it("exports generated validation results with original store and job references", async () => {
    await failure();
    await service.refreshReconciliation();
    const preview = await service.previewCorrections([
      correction({ existingCode: "invalid" }),
    ]);
    const rows = await service.validatedWorkbookRows(preview.id);
    expect(rows[0]).toMatchObject({
      store: "Hounslow",
      storeId: 1,
      identifier: "000123",
    });
    expect(rows[0].validationStatus).toContain("ERROR");
    expect(rows[0].jobs).toBeTruthy();
  });

  it("collects all jobs, keeps parsing failures separate, exports text and supports 20,000+ identifiers", async () => {
    const codes = Array.from(
      { length: 20001 },
      (_, i) => "X" + String(i).padStart(6, "0"),
    );
    await failure(codes);
    await client.exec(
      "INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,error_message) VALUES(1,'wastage','manual','failed','Parsing failed')",
    );
    await service.refreshReconciliation();
    const page = await service.listIdentifiers({});
    expect(page.total).toBe(20001);
    expect(page.items).toHaveLength(50);
    expect((await service.listIdentifiers({ page: 401 })).items).toHaveLength(
      1,
    );
    const all = await service.listIdentifiers({}, true);
    const bytes = await buildReviewWorkbook(all.items);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = book.getWorksheet("Unmatched Products")!;
    expect(sheet.rowCount).toBe(20002);
    expect(sheet.getCell("D2").value).toBe("X000000");
    expect(sheet.getCell("D2").numFmt).toBe("@");
    expect((await readCorrections(Buffer.from(bytes))).length).toBe(20001);
  }, 60000);
  it("includes identifiers older than the latest 1,000 jobs", async () => {
    await failure();
    await client.exec(
      "INSERT INTO data_import_runs(store_id,source_type,trigger_type,status) SELECT 1,'rtc','manual','failed' FROM generate_series(1,1001)",
    );
    await service.refreshReconciliation();
    expect((await service.listIdentifiers({})).total).toBe(1);
  });
  it("approves an alias, queues exactly once, preserves original failure and audit, and reuploads safely", async () => {
    await failure();
    await service.refreshReconciliation();
    const preview = await service.previewCorrections([correction()]);
    const result = await service.approveCorrections(preview.id, "Operator");
    expect(result).toMatchObject({ applied: 1, queued: 1 });
    expect(await service.approveCorrections(preview.id, "Operator")).toEqual(
      result,
    );
    expect((await service.listIdentifiers({})).total).toBe(0);
    expect((await service.listIdentifiers({ status: "resolved" })).total).toBe(
      1,
    );
    expect((await service.refreshReconciliation()).queued).toBe(0);
    await approve([correction()]);
    expect(
      (await client.query("SELECT * FROM crm_product_code_aliases")).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "SELECT * FROM data_import_runs WHERE status='queued'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "SELECT * FROM data_import_runs WHERE status='failed'",
        )
      ).rows,
    ).toHaveLength(1);
    const [identifier] = (
      await client.query<{ id: number }>(
        "SELECT id FROM crm_product_identifiers",
      )
    ).rows;
    expect(await service.auditHistory(String(identifier.id))).toHaveLength(2);
  });
  it("creates store products and barcodes once, leaves blank actions pending", async () => {
    await failure(["000123", "000124"], "Barcode");
    await service.refreshReconciliation();
    const row = correction({
      kind: "Barcode",
      action: "ADD_NEW",
      newCode: "NEW001",
      productName: "New milk",
      department: "Dairy",
    });
    await approve([
      row,
      correction({ kind: "Barcode", identifier: "000124", action: "" }),
    ]);
    expect((await service.listIdentifiers({})).total).toBe(1);
    expect(
      (
        await client.query(
          "SELECT * FROM product_barcodes WHERE barcode='000123'",
        )
      ).rows,
    ).toHaveLength(1);
    await approve([row]);
    expect(
      (await client.query("SELECT * FROM products WHERE name='New milk'")).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "SELECT * FROM data_import_runs WHERE status='queued'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects duplicates, competing barcodes, invalid stores and missing required fields", async () => {
    await failure(["000123", "000124"]);
    await service.refreshReconciliation();
    for (const rows of [
      [correction(), correction()],
      [correction({ storeId: 2, existingCode: "10001" })],
      [correction({ barcode: "5901234560002" })],
      [correction({ action: "ADD_NEW" })],
      [correction({ existingCode: "99999" })],
    ]) {
      const preview = await service.previewCorrections(rows);
      expect(preview.summary.errors).toBeGreaterThan(0);
      await expect(
        service.approveCorrections(preview.id, "Test"),
      ).rejects.toThrow("Validation failed");
    }
    expect(
      (await client.query("SELECT * FROM crm_product_code_aliases")).rows,
    ).toHaveLength(0);
  });
  it("rejects two new products claiming the same barcode and never changes another store", async () => {
    await failure(["N1", "N2"]);
    await service.refreshReconciliation();
    const rows = ["N1", "N2"].map((identifier) =>
      correction({
        identifier,
        action: "ADD_NEW",
        newCode: identifier,
        productName: identifier,
        department: "Dairy",
        barcode: "000099",
      }),
    );
    expect((await service.previewCorrections(rows)).summary.errors).toBe(2);
    await approve([correction({ identifier: "N1" })]);
    const aliases = (
      await client.query("SELECT store_id FROM crm_product_code_aliases")
    ).rows;
    expect(aliases).toEqual([{ store_id: 1 }]);
    await expect(
      client.exec("INSERT INTO crm_product_code_aliases VALUES(2,'cross',11)"),
    ).rejects.toThrow("another store");
  });
  it("revalidates approval after another edit and rolls back the entire batch on a database failure", async () => {
    await failure(["000123", "000124"]);
    await service.refreshReconciliation();
    const rows = [correction(), correction({ identifier: "000124" })];
    const preview = await service.previewCorrections(rows);
    await client.exec(
      "CREATE FUNCTION reject_second_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notes='fail' THEN RAISE EXCEPTION 'Injected rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_second BEFORE INSERT ON crm_reconciliation_audit FOR EACH ROW EXECUTE FUNCTION reject_second_audit();",
    );
    try {
      const batch = await service.previewCorrections([
        rows[0],
        { ...rows[1], notes: "fail" },
      ]);
      await expect(
        service.approveCorrections(batch.id, "Test"),
      ).rejects.toThrow();
      expect(
        (await client.query("SELECT * FROM crm_product_code_aliases")).rows,
      ).toHaveLength(0);
      expect((await service.listIdentifiers({})).total).toBe(2);
    } finally {
      await client.exec(
        "DROP TRIGGER reject_second ON crm_reconciliation_audit;DROP FUNCTION reject_second_audit()",
      );
    }
    await client.exec(
      "INSERT INTO product_barcodes(store_id,store_product_id,barcode) VALUES(1,12,'000999')",
    );
    // Changed target barcode between preview and approval is rejected.
    const stale = await service.previewCorrections([
      correction({ barcode: "000888" }),
    ]);
    await client.exec(
      "INSERT INTO product_barcodes(store_id,store_product_id,barcode) VALUES(1,12,'000888')",
    );
    await expect(service.approveCorrections(stale.id, "Test")).rejects.toThrow(
      "Validation failed",
    );
    expect(preview.summary.errors).toBe(0);
  });
  it("automatically resolves product-master updates and never loops with an incompatible worker", async () => {
    await failure();
    await service.refreshReconciliation();
    await client.exec(
      "INSERT INTO store_products(store_id,product_id,store_product_code) VALUES(1,1,'000123')",
    );
    expect((await service.refreshReconciliation()).queued).toBe(1);
    await client.exec(
      "UPDATE data_import_runs SET status='failed',details=details||'{\"unknown_product_codes\":[\"000123\"]}'::jsonb WHERE status='queued'",
    );
    expect((await service.refreshReconciliation()).queued).toBe(0);
    expect((await service.refreshReconciliation()).queued).toBe(0);
  });
  it("never replaces a newer successful report or queues superseded historical failures", async () => {
    await failure();
    await failure();
    await service.refreshReconciliation();
    await approve([correction()]);
    expect(
      (
        await client.query(
          "SELECT * FROM data_import_runs WHERE status='queued'",
        )
      ).rows,
    ).toHaveLength(1);
    await client.exec(
      "UPDATE data_import_runs SET status='success' WHERE status='queued'",
    );
    expect((await service.refreshReconciliation()).queued).toBe(0);
  });
  it("supports filters and validates date input", async () => {
    await failure();
    await failure(["0009"], "Barcode", "rtc", "2026-10-16", 2);
    await service.refreshReconciliation();
    expect(
      (
        await service.listIdentifiers({
          storeId: 2,
          feed: "rtc",
          kind: "Barcode",
          search: "0009",
          from: "2026-10-16",
          to: "2026-10-16",
        })
      ).total,
    ).toBe(1);
    expect((await service.listIdentifiers({ from: "2026-10-17" })).total).toBe(
      0,
    );
    expect(() =>
      service.parseFilters(new URLSearchParams("from=2026-02-31")),
    ).toThrow("Invalid report date");
  });
});
describe("Excel validation", () => {
  it("preserves leading zeros and rejects numeric identifiers, formulas and wrong worksheets", async () => {
    const bytes = await buildReviewWorkbook([
      {
        store: "Store",
        storeId: 1,
        kind: "Barcode",
        identifier: "000123",
        action: "MATCH_EXISTING",
        existingCode: "10001",
      },
    ]);
    expect((await readCorrections(Buffer.from(bytes)))[0].identifier).toBe(
      "000123",
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    for (const value of [123, { formula: "1+1" }]) {
      book.worksheets[0].getCell("D2").value = value;
      await expect(
        readCorrections(Buffer.from(await book.xlsx.writeBuffer())),
      ).rejects.toThrow();
    }
    const wrong = new ExcelJS.Workbook();
    wrong.addWorksheet("Other");
    await expect(
      readCorrections(Buffer.from(await wrong.xlsx.writeBuffer())),
    ).rejects.toThrow("Missing Unmatched");
    await expect(readCorrections(Buffer.from("invalid"))).rejects.toThrow(
      "valid .xlsx",
    );
  });
});
