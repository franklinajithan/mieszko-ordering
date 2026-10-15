import { buildOrderSheetResult } from "@/services/order-sheet.service";
import ExcelJS from "exceljs";
import {
  dailySalesRepository,
  orderRepository,
} from "@/repositories";
import { soldQtyForPeriod } from "@/utils/period-sales";

function formatPeriodColumn(startDate: string, endDate: string): string {
  const fmt = (iso: string) => {
    const [year, month, day] = iso.split("-");
    return `${day}.${month}.${year.slice(-2)}`;
  };
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("").trim();
  }
  if (typeof value === "object" && "result" in value) {
    return cellText(value.result as ExcelJS.CellValue);
  }
  return String(value).trim();
}

export async function exportHoDairyOrderToExcel(orderId: number): Promise<Buffer> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const [items, periods] = await Promise.all([
    orderRepository.getOrderItemsWithDetails(orderId),
    orderRepository.getPeriods(orderId),
  ]);
  const result = await buildOrderSheetResult(orderId);
  const savedById = new Map(result.items.map(item => [item.orderItemId,item]));
  const periodColumns = periods.map(period => ({key:period.periodKey,header:formatPeriodColumn(period.startDate,period.endDate)}));
  const dailyColumns = result.dailySalesLabels.map(date => ({date,header:date}));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Product");

  const headers = [
    "ProductCode",
    "InnerEan",
    "ItemName1",
    "ItemGroupName",
    ...periodColumns.map((column) => column.header),
    ...dailyColumns.map((column) => column.header),
    "Highest Sold Qty",
    "Book Stock",
    "Received Not Posted",
    "Future Delivery",
    "Forecast Sales",
    "Suggested Order Qty",
    "Final Order Qty",
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const { item, storeProduct, product, orderDepartmentName } of items) {
    const periodValues = periodColumns.map((column) =>
      Number(soldQtyForPeriod(item.periodSales, column.key)),
    );

    const saved = savedById.get(item.id);
    const dailyValues = saved?.dailySales.map(Number) ?? [];

    sheet.addRow([
      storeProduct.storeProductCode,
      saved?.barcode ?? "",
      product.name,
      orderDepartmentName ?? product.department,
      ...periodValues,
      ...dailyValues,
      Number(item.highestSoldQty),
      Number(item.bookStockQty),
      Number(item.receivedNotPostedQty),
      Number(item.futureDeliveryTotalQty),
      Number(item.forecastSalesQty),
      Number(item.suggestedOrderQty),
      Number(item.finalOrderQty),
    ]);
  }

  for (let col = 5; col <= headers.length; col += 1) {
    sheet.getColumn(col).numFmt = "#,##0.00";
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };


  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function fillHoDairyTemplate(
  orderId: number,
  templateBuffer: Buffer,
): Promise<Buffer> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const [items, periods] = await Promise.all([
    orderRepository.getOrderItemsWithDetails(orderId),
    orderRepository.getPeriods(orderId),
  ]);

  if (order.storeIds.length !== 1) throw new Error("Template filling requires a single-store order");
  const itemByCode = new Map(
    items.map(({ item, storeProduct, product }) => [
      storeProduct.storeProductCode,
      { item, storeProduct, product },
    ]),
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets.find((ws) => ws.name === "Product") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Template has no worksheets");

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  const periodByHeader = new Map(
    periods.map((period) => [
      formatPeriodColumn(period.startDate, period.endDate),
      period,
    ]),
  );

  const dailySalesRepo = dailySalesRepository;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const productCode = cellText(row.getCell(1).value);
    if (!productCode) continue;

    const match = itemByCode.get(productCode);
    if (!match) continue;

    const { item, storeProduct } = match;

    for (let col = 5; col <= headers.length; col += 1) {
      const header = headers[col - 1];
      if (!header) continue;

      let value: number | "" = "";

      if (header === "Highest Sold Qty") {
        value = Number(item.highestSoldQty);
      } else if (header === "Book Stock") {
        value = Number(item.bookStockQty);
      } else {
        const period =
          periodByHeader.get(header) ??
          [...periodByHeader.entries()].find(([label]) =>
            label.replace(/\s+/g, "") === header.replace(/\s+/g, ""),
          )?.[1];
        if (period) {
          value = Number(soldQtyForPeriod(item.periodSales, period.periodKey));
        } else if (/^\d{2}\.\d{2}$/.test(header) && dailySalesRepo) {
          const [day, month] = header.split(".");
          const year = order.bookStockDate.slice(0, 4);
          const salesDate = `${year}-${month}-${day}`;
          const sales = await dailySalesRepo.getSalesForProduct(storeProduct.id);
          const sale = sales.find((row) => row.salesDate === salesDate);
          value = sale ? Number(sale.soldQty) : "";
        }
      }

      if (value !== "") {
        row.getCell(col).value = value;
        row.getCell(col).numFmt = "#,##0.00";
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportHoDairyWithTemplateFromForm(
  formData: FormData,
): Promise<{ base64: string; fileName: string }> {
  const rawOrderId = formData.get("orderId");
  const orderId = Number(rawOrderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("Invalid order id");
  }

  const template = formData.get("template");
  if (!(template instanceof File)) {
    throw new Error("HO Dairy template file is required");
  }

  const templateBuffer = Buffer.from(await template.arrayBuffer());
  const buffer = await fillHoDairyTemplate(orderId, templateBuffer);
  return {
    base64: buffer.toString("base64"),
    fileName: `HO Dairy-filled-${orderId}.xlsx`,
  };
}
