import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { dataImportRuns, stores } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const failures = await db.select({
    id: dataImportRuns.id,
    storeId: dataImportRuns.storeId,
    storeName: stores.name,
    date: dataImportRuns.sourceStartDate,
    source: dataImportRuns.sourceType,
    details: dataImportRuns.details,
  }).from(dataImportRuns)
    .leftJoin(stores, eq(dataImportRuns.storeId, stores.id))
    .where(eq(dataImportRuns.status, "failed"))
    .orderBy(desc(dataImportRuns.id)).limit(1000);

  const items = new Map<string, {
    store: string; storeId: number; kind: string; identifier: string;
    jobs: Set<number>; dates: Set<string>; sources: Set<string>;
  }>();
  for (const run of failures) {
    if (run.storeId == null) continue;
    const details = run.details as Record<string, unknown> | null;
    for (const [field, kind] of [["unmatched_barcodes", "Barcode"], ["unknown_product_codes", "Product code"]] as const) {
      const values = details?.[field];
      if (!Array.isArray(values)) continue;
      for (const raw of values) {
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const identifier = String(raw).trim();
        if (!identifier) continue;
        const key = JSON.stringify([run.storeId, kind, identifier]);
        let item = items.get(key);
        if (!item) {
          item = { store: run.storeName ?? "Unknown", storeId: run.storeId, kind, identifier, jobs: new Set(), dates: new Set(), sources: new Set() };
          items.set(key, item);
        }
        item.jobs.add(run.id);
        if (run.date) item.dates.add(run.date);
        item.sources.add(run.source);
      }
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Unmatched Products", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Store", key: "store", width: 22 },
    { header: "Store ID", key: "storeId", width: 12 },
    { header: "Identifier Type", key: "kind", width: 19 },
    { header: "CRM Identifier", key: "identifier", width: 24, style: { numFmt: "@" } },
    { header: "Affected Jobs", key: "jobs", width: 30 },
    { header: "Report Dates", key: "dates", width: 35 },
    { header: "Feeds", key: "sources", width: 27 },
    { header: "Action (MATCH_EXISTING / ADD_NEW)", key: "action", width: 34 },
    { header: "Existing Store Product Code", key: "existingCode", width: 30, style: { numFmt: "@" } },
    { header: "New Product Name", key: "productName", width: 35 },
    { header: "Department", key: "department", width: 25 },
    { header: "Review Notes", key: "notes", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  sheet.autoFilter = { from: "A1", to: "L1" };
  for (const item of [...items.values()].sort((a, b) => a.store.localeCompare(b.store) || a.identifier.localeCompare(b.identifier))) {
    const row = sheet.addRow({
      store: item.store, storeId: item.storeId, kind: item.kind,
      identifier: item.identifier, jobs: [...item.jobs].join(", "),
      dates: [...item.dates].sort().join(", "), sources: [...item.sources].join(", "),
    });
    row.getCell(4).numFmt = "@";
    row.getCell(9).numFmt = "@";
  }
  const guide = workbook.addWorksheet("Instructions");
  guide.getColumn(1).width = 105;
  [
    "This is a review/export template, NOT an automatic database update.",
    "Do not change Store ID, Identifier Type or CRM Identifier.",
    "For existing products enter MATCH_EXISTING and the exact existing store product code.",
    "For new products enter ADD_NEW, product name and department.",
    "Leave unknown products blank for later review. Never guess product matches.",
    "The upload and database validation workflow must be enabled before this file can update products.",
    "The export includes identifiers from the latest 1,000 failed jobs only.",
  ].forEach(line => guide.addRow([line]));
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Mieszko_Unmatched_Products_Review.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
