import ExcelJS from "exceljs";
import { orderRepository, storeRepository, supplierRepository } from "@/repositories";
import { exportHoDairyOrderToExcel } from "@/services/orders/ho-dairy-export.service";
import { primaryStoreId, settingsFromOrder } from "@/services/order-sheet.service";
import { periodSalesList } from "@/utils/period-sales";

function quoteForSupplier(
  quotes: Array<{
    supplierId: number;
    supplierProductCode?: string | null;
    netPrice?: string | null;
    caseSize?: string | null;
    isCheapest?: boolean;
  }> | null | undefined,
  supplierId: number,
) {
  return quotes?.find((quote) => quote.supplierId === supplierId) ?? null;
}

export async function exportOrderToExcel(orderId: number): Promise<Buffer> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const metadata = settingsFromOrder(order);
  const items = await orderRepository.getOrderItemsWithDetails(orderId);
  const selectedSuppliers = metadata.supplierIds?.length
    ? (await supplierRepository.getByIds(metadata.supplierIds)).map((supplier) => ({
        supplier,
      }))
    : await orderRepository.getSelectedSuppliers(orderId);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Order");

  sheet.addRow(["Mieszko Dairy Order Export"]);
  sheet.addRow(["Order ID", orderId]);
  sheet.addRow(["Book stock date", order.bookStockDate]);
  sheet.addRow(["Delivery date", order.deliveryDate]);
  sheet.addRow([
    "Selected suppliers",
    selectedSuppliers.map((s) => s.supplier.code).join(", "),
  ]);
  sheet.addRow([]);

  const periodCount = metadata.comparisonPeriods.length;
  const headers = [
    "Store product code",
    "Product name",
    "Department",
    ...Array.from({ length: periodCount }, (_, index) => `Period ${index + 1} sales`),
    "Highest sold",
    "Book stock",
    "Received not posted",
    "Future delivery total",
    "Forecast sales",
    "Shortage",
    "Projected final stock",
    "Suggested qty",
    "Final qty",
    ...selectedSuppliers.flatMap((s) => [
      `${s.supplier.code} code`,
      `${s.supplier.code} net price`,
      `${s.supplier.code} case size`,
    ]),
    "Cheapest supplier",
    "Cheapest net price",
    "Estimated line cost",
    "Price status",
    "Warning",
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  for (const { item, storeProduct, product, orderDepartmentName } of items) {
    const rowQuotes = selectedSuppliers.flatMap(({ supplier }) => {
      const quote = quoteForSupplier(item.supplierQuotes, supplier.id);
      return [
        quote?.supplierProductCode ?? "",
        quote?.netPrice ? Number(quote.netPrice) : "",
        quote?.caseSize ?? "",
      ];
    });

    const cheapestSupplier = selectedSuppliers.find(
      ({ supplier }) => supplier.id === item.cheapestSupplierId,
    );

    sheet.addRow([
      storeProduct.storeProductCode,
      product.name,
      orderDepartmentName ?? product.department,
      ...periodSalesList(item.periodSales, periodCount).map(Number),
      Number(item.highestSoldQty),
      Number(item.bookStockQty),
      Number(item.receivedNotPostedQty),
      Number(item.futureDeliveryTotalQty),
      Number(item.forecastSalesQty),
      Number(item.shortageQty),
      Number(item.projectedFinalStockQty),
      Number(item.suggestedOrderQty),
      Number(item.finalOrderQty),
      ...rowQuotes,
      cheapestSupplier?.supplier.code ?? "",
      item.cheapestNetPrice ? Number(item.cheapestNetPrice) : "",
      item.estimatedLineCost ? Number(item.estimatedLineCost) : "",
      item.priceStatus,
      item.warning ?? "",
    ]);
  }

  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: headers.length },
  };

  for (let col = 4; col <= headers.length - 3; col++) {
    sheet.getColumn(col).numFmt = "#,##0.00";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportOrderDownload(orderId: number): Promise<{
  base64: string;
  fileName: string;
}> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");
  const store = await storeRepository.getById(primaryStoreId(order));

  const buffer =
    store?.erpType === "glopos"
      ? await exportHoDairyOrderToExcel(orderId)
      : await exportOrderToExcel(orderId);

  return {
    base64: buffer.toString("base64"),
    fileName:
      store?.erpType === "glopos"
        ? `HO Dairy-order-${orderId}.xlsx`
        : `order-${orderId}.xlsx`,
  };
}
