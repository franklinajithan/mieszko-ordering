import ExcelJS from "exceljs";
import {
  dailySalesRepository,
  orderRepository,
} from "@/repositories/postgres";

function formatDailyColumn(dateIso: string): string {
  const [, month, day] = dateIso.split("-");
  return `${day}.${month}`;
}

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
  const dailySalesRepo = dailySalesRepository;

  const itemByCode = new Map(
    items.map(({ item, storeProduct, product }) => [
      storeProduct.storeProductCode,
      { item, storeProduct, product },
    ]),
  );

  const periodColumns = periods.map((period) => ({
    key: period.periodKey,
    header: formatPeriodColumn(period.startDate, period.endDate),
    startDate: period.startDate,
    endDate: period.endDate,
  }));

  const dailyDates = new Set<string>();
  if (dailySalesRepo) {
    for (const { storeProduct } of items) {
      const sales = await dailySalesRepo.getSalesForProduct(storeProduct.id);
      for (const sale of sales) {
        dailyDates.add(sale.salesDate);
      }
    }
  }

  const sortedDailyDates = [...dailyDates].sort();
  const dailyColumns = sortedDailyDates.map((date) => ({
    date,
    header: formatDailyColumn(date),
  }));

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
    const periodValues = await Promise.all(
      periodColumns.map(async (column) => {
        if (column.key === "period_1") return Number(item.period1Sales);
        if (column.key === "period_2") return Number(item.period2Sales);
        if (column.key === "period_3") return Number(item.period3Sales);
        if (column.key === "previous_year") return Number(item.previousYearSales);
        if (dailySalesRepo) {
          return Number(
            await dailySalesRepo.sumSalesInPeriod(
              storeProduct.id,
              column.startDate,
              column.endDate,
            ),
          );
        }
        return 0;
      }),
    );

    const dailyValues = await Promise.all(
      dailyColumns.map(async (column) => {
        if (!dailySalesRepo) return "";
        const sales = await dailySalesRepo.getSalesForProduct(storeProduct.id);
        const match = sales.find((row) => row.salesDate === column.date);
        return match ? Number(match.soldQty) : "";
      }),
    );

    sheet.addRow([
      storeProduct.storeProductCode,
      "",
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

  void itemByCode;

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
          if (period.periodKey === "period_1") value = Number(item.period1Sales);
          else if (period.periodKey === "period_2") value = Number(item.period2Sales);
          else if (period.periodKey === "period_3") value = Number(item.period3Sales);
          else if (period.periodKey === "previous_year") {
            value = Number(item.previousYearSales);
          }
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
