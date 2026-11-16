import { and, eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { db } from "@/db";
import { admOrders } from "@/db/schema";
import { getAdmCatalog } from "@/lib/adm/catalog";
import { apiError } from "@/lib/api/http";
import { storeRepository } from "@/repositories/stores";
import { isIsoDateString } from "@/utils/iso-date";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const storeId = Number(params.get("storeId"));
  const date = params.get("deliveryDate");
  if (!Number.isInteger(storeId) || storeId < 1 || storeId > 2147483647 || !isIsoDateString(date)) {
    return apiError("Choose a shop and a valid delivery date.");
  }
  const [[order], shop, catalog] = await Promise.all([
    db.select().from(admOrders).where(and(eq(admOrders.storeId, storeId), eq(admOrders.deliveryDate, date))),
    storeRepository.getById(storeId),
    getAdmCatalog(storeId),
  ]);
  if (!order || !shop) return apiError("Submitted ADM order not found.", 404);

  const document = new PDFDocument({ size: "A4", margin: 44 });
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  if (existsSync(font)) document.font(font);
  document.fontSize(21).text("ADM Order");
  document.moveDown(0.5).fontSize(12)
    .text(`Shop  ${shop.name}`)
    .text(`Delivery  ${date}`)
    .text(`Submitted  ${order.submittedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  document.moveDown().fontSize(10);
  const codes = new Map(catalog.items.map(({ name, code }) => [name, code]));
  for (const [name, quantity] of Object.entries(order.quantities).sort(([a], [b]) => a.localeCompare(b))) {
    const code = codes.get(name);
    document.text(`${quantity}  |  ${code ? code + "  |  " : ""}${name}`, { paragraphGap: 6 });
  }
  const shopName = shop.name.replace(/[^a-zA-Z0-9-]+/g, "_");
  const response = new Response(Readable.toWeb(document) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ADM_Order_${shopName}_${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
  document.end();
  return response;
}
