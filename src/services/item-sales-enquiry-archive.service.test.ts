import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "@/app/api/reports/item-sales-enquiry/archive/[date]/route";
import { GET as getWorkbook } from "@/app/api/reports/item-sales-enquiry/files/[store]/[date]/route";
import { report6Filename, report6Stores, type Report6Store } from "@/lib/item-sales-enquiry";

vi.mock("server-only", () => ({}));

const date = "2026-11-13";
const stores = Object.keys(report6Stores) as Report6Store[];
let archive: string;

beforeEach(async () => {
  archive = await mkdtemp(path.join(os.tmpdir(), "report6-"));
  vi.stubEnv("ITEM_SALES_ENQUIRY_ARCHIVE_DIRECTORY", archive);
  vi.stubEnv("ITEM_SALES_ENQUIRY_WORKER_DIRECTORY", path.join(archive, "no-crm-worker"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(archive, { recursive: true, force: true });
});

function workbookPath(store: Report6Store, day: string) {
  return path.join(archive, "item-sales-enquiry", "files", store, `${day}.xlsx`);
}

async function saveWorkbook(store: Report6Store, day = date) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sales").addRow([store, day, 42]);
  const bytes = await workbook.xlsx.writeBuffer();
  const filename = workbookPath(store, day);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, Buffer.from(bytes));
  return Buffer.from(bytes);
}

function getArchive(day: string, download = false) {
  return GET(new Request(`http://localhost/archive/${encodeURIComponent(day)}${download ? "?download=zip" : ""}`),
    { params: Promise.resolve({ date: day }) });
}

test("packages all seven workbooks without changing their filenames or Excel data", async () => {
  const originals = await Promise.all(stores.map(store => saveWorkbook(store)));
  expect(await (await getArchive(date)).json()).toEqual({ available: stores });

  const response = await getArchive(date, true);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/zip");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="Report6_Item_Sales_${date}.zip"`);
  const zip = await JSZip.loadAsync(await response.arrayBuffer(), { checkCRC32: true });
  expect(Object.keys(zip.files)).toEqual(stores.map(store => `${report6Stores[store]}/${report6Filename({ store, date })}`));
  for (const [index, store] of stores.entries()) {
    const bytes = await zip.file(`${report6Stores[store]}/${report6Filename({ store, date })}`)!.async("nodebuffer");
    expect(bytes).toEqual(originals[index]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
    expect(workbook.getWorksheet("Sales")!.getRow(1).values).toEqual([, store, date, 42]);
  }

  const single = await getWorkbook(new Request("http://localhost"), { params: Promise.resolve({ store: "HNS", date }) });
  expect(Buffer.from(await single.arrayBuffer())).toEqual(originals[0]);
});

test("uses the selected date and skips missing, invalid and symlinked reports", async () => {
  await saveWorkbook("EAS");
  await saveWorkbook("STR", "2026-11-12");
  const invalid = workbookPath("GRV", date);
  await mkdir(path.dirname(invalid), { recursive: true });
  await writeFile(invalid, "<html>CRM error</html>");
  const symlinked = workbookPath("HYS", date);
  await mkdir(path.dirname(symlinked), { recursive: true });
  await symlink(workbookPath("EAS", date), symlinked);
  await symlink(path.dirname(workbookPath("EAS", date)), path.dirname(workbookPath("PVL", date)));

  expect(await (await getArchive(date)).json()).toEqual({ available: ["EAS"] });
  const zip = await JSZip.loadAsync(await (await getArchive(date, true)).arrayBuffer());
  expect(Object.keys(zip.files)).toEqual([`Eastham/${report6Filename({ store: "EAS", date })}`]);
});

test("returns an empty list and no ZIP when the archive has no completed files", async () => {
  expect(await (await getArchive(date)).json()).toEqual({ available: [] });
  expect((await getArchive(date, true)).status).toBe(404);
});

test("rejects invalid dates and path traversal", async () => {
  expect((await getArchive("2026-02-30", true)).status).toBe(400);
  expect((await getArchive("../../2026-11-13", true)).status).toBe(400);
});
