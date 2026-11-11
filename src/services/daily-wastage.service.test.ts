import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, test, vi } from "vitest";
import { GET } from "@/app/api/daily-wastage/[date]/[storeId]/route";
import { GET as getProgress, POST as startRun } from "@/app/api/daily-wastage/[date]/run/route";
import { listDailyWastage } from "./daily-wastage.service";

vi.mock("server-only", () => ({}));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb }));

test("lists stores by report date and downloads the original bytes even when matching is pending", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "daily-wastage-"));
  const db = new PGlite();
  const date = "2026-11-10";
  const original = Buffer.from("%PDF-1.7\nfixture\n%%EOF\n");
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
    await writeFile(path.join(root, "10", "report.pdf"), original);
    await mkdir(path.join(root, "11"));
    await writeFile(path.join(root, "11", "report.xls"), "Existing Excel export");
    await writeFile(path.join(root, "11", "report.pdf"), "<html>Invalid PDF</html>");
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
        { storeId: 1, name: "Hayes", filename: "Wastage_Hayes_2026-11-10.pdf" },
        { storeId: 3, name: "Hounslow", filename: null },
        { storeId: 2, name: "Watford", filename: null },
      ],
    });
    expect((await listDailyWastage("2026-11-09")).stores.find((store) => store.storeId === 3)?.filename).toBe("Wastage_Hounslow_2026-11-09.pdf");
    const response = await download(date, "1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Wastage_Hayes_2026-11-10.pdf"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
    expect((await download(date, "2")).status).toBe(404);
    expect((await download(date, "3")).status).toBe(404);
    expect((await download("2026-02-30", "1")).status).toBe(400);
    const manual = path.join(root, ".manual-pdfs", date);
    await mkdir(path.join(manual, "3"), { recursive: true });
    await writeFile(path.join(manual, "3", "report.pdf"), original);
    const status = {
      state: "running", message: "Preparing the Nibua export.", updatedAt: Date.now(),
      stores: [{ id: 3, name: "Hounslow", state: "complete", step: "PDF saved" }],
    };
    await writeFile(path.join(manual, "status.json"), JSON.stringify(status));

    expect((await listDailyWastage(date)).stores.find(store => store.storeId === 3)?.filename)
      .toBe("Wastage_Hounslow_2026-11-10.pdf");
    expect(Buffer.from(await (await download(date, "3")).arrayBuffer())).toEqual(original);
    const context = { params: Promise.resolve({ date }) };
    const progress = await getProgress(new Request("http://localhost"), context);
    expect(await progress.json()).toEqual(status);
    const crossOrigin = new Request("http://localhost", { method: "POST", headers: { Origin: "http://other.test" } });
    expect((await startRun(crossOrigin, context)).status).toBe(403);

  } finally {
    vi.unstubAllEnvs();
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
