import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, test, vi } from "vitest";
import { GET } from "@/app/api/daily-wastage/[date]/[storeId]/route";
import { listDailyWastage } from "./daily-wastage.service";

vi.mock("server-only", () => ({}));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb }));

test("lists stores by report date and downloads the original bytes even when matching is pending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "daily-wastage-"));
  const db = new PGlite();
  const date = "2026-11-10";
  const original = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0xff]);
  const download = (day: string, storeId: string) => GET(new Request("http://localhost"), {
    params: Promise.resolve({ date: day, storeId }),
  });

  try {
    vi.stubEnv("DAILY_WASTAGE_DOWNLOAD_DIRECTORY", root);
    getDb.mockReturnValue(drizzle(db));
    await db.exec(`
      CREATE TABLE stores (id integer, name text, is_active boolean);
      CREATE TABLE data_import_runs (
        id bigint, store_id integer, source_type text, source_start_date date, source_end_date date,
        source_file_path text, downloaded_at timestamptz, status text, details jsonb
      );
      INSERT INTO stores VALUES (1, 'Hayes', true), (2, 'Watford', true), (3, 'Hounslow', true);
    `);
    await mkdir(path.join(root, "10"));
    await writeFile(path.join(root, "10", "report.xls"), original);
    await symlink(path.join(root, "10"), path.join(root, "20"));
    for (const [run, store, day, source, status, details] of [
      [10, 1, date, path.join(root, "10", "report.xls"), "failed", { source_sha256: "fixture" }],
      [11, 1, date, path.join(root, "11", "report.xls"), "success", {}],
      [20, 2, date, path.join(root, "20", "report.xls"), "success", {}],
      [30, 3, "2026-11-09", path.join(root, "10", "report.xls"), "success", {}],
    ]) {
      await db.query(
        "INSERT INTO data_import_runs VALUES ($1, $2, 'wastage', $3, $3, $4, now(), $5, $6)",
        [run, store, day, source, status, JSON.stringify(details)],
      );
    }
    expect(await listDailyWastage(date)).toEqual({
      state: "ready",
      stores: [
        { storeId: 1, name: "Hayes", filename: "report.xls" },
        { storeId: 3, name: "Hounslow", filename: null },
        { storeId: 2, name: "Watford", filename: null },
      ],
    });
    expect((await listDailyWastage("2026-11-09")).stores.find((store) => store.storeId === 3)?.filename).toBe("report.xls");
    const response = await download(date, "1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="report.xls"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
    expect((await download(date, "2")).status).toBe(404);
    expect((await download(date, "3")).status).toBe(404);
    expect((await download("2026-02-30", "1")).status).toBe(400);
  } finally {
    vi.unstubAllEnvs();
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
