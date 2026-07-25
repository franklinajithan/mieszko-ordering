import ExcelJS from "exceljs";
import { isDemoMode } from "@/lib/runtime-config";

type OrderRepo =
  | typeof import("@/repositories/postgres").orderRepository
  | typeof import("@/repositories/mock").orderRepository;

async function getOrderRepo(): Promise<OrderRepo> {
  if (isDemoMode()) {
    return (await import("@/repositories/mock")).orderRepository;
  }
  return (await import("@/repositories/postgres")).orderRepository;
}

export async function exportOrderToExcel(orderId: number): Promise<Buffer> {
  const orderRepository = await getOrderRepo();
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const items = await orderRepository.getOrderItemsWithDetails(orderId);
  const supplierPrices = await orderRepository.getItemSupplierPrices(orderId);
  const selectedSuppliers = await orderRepository.getSelectedSuppliers(orderId);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Order");

  sheet.addRow(["Mieszko Dairy Order Export"]);
  sheet.addRow(["Order ID", orderId]);
  sheet.addRow(["Book stock date", order.bookStockDate]);
  sheet.addRow(["Client delivery date", order.clientDeliveryDate]);
  sheet.addRow([
    "Selected suppliers",
    selectedSuppliers.map((s) => s.supplier.code).join(", "),
  ]);
  sheet.addRow([]);

  const headers = [
    "Store product code",
    "Product name",
    "Department",
    "Period 1 sales",
    "Period 2 sales",
    "Period 3 sales",
    "Previous year sales",
    "Highest sold",
    "Book stock",
    "Received not posted",
    "Future delivery total",
    "Forecast sales",
    "Shortage",
    "Projected final stock",
    "Suggested qty",
    "Final qty",
    ...selectedSuppliers.map((s) => `${s.supplier.code} net price`),
    "Cheapest supplier",
    "Cheapest net price",
    "Estimated line cost",
    "Price status",
    "Warning",
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  for (const { item, storeProduct, product } of items) {
    const rowPrices = selectedSuppliers.map(({ supplier }) => {
      const snapshot = supplierPrices.find(
        (p) =>
          p.price.orderItemId === item.id &&
          p.supplier.id === supplier.id,
      );
      return snapshot?.price.netPrice ?? "";
    });

    const cheapestSupplier = supplierPrices.find(
      (p) => p.price.orderItemId === item.id && p.price.isCheapest,
    );

    sheet.addRow([
      storeProduct.storeProductCode,
      product.name,
      product.orderDepartment ?? product.department,
      Number(item.period1Sales),
      Number(item.period2Sales),
      Number(item.period3Sales),
      Number(item.previousYearSales),
      Number(item.highestSoldQty),
      Number(item.bookStockQty),
      Number(item.receivedNotPostedQty),
      Number(item.futureDeliveryTotalQty),
      Number(item.forecastSalesQty),
      Number(item.shortageQty),
      Number(item.projectedFinalStockQty),
      Number(item.suggestedOrderQty),
      Number(item.finalOrderQty),
      ...rowPrices.map((p) => (p ? Number(p) : "")),
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
