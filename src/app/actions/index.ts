"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/runtime-config";
import {
  orderRepository,
  productRepository,
  storeRepository,
  supplierRepository,
} from "@/repositories";
import { importDailySalesRows } from "@/services/daily-sales-import.service";
import { importBookStockRows } from "@/services/book-stock-import.service";
import {
  applyBookStockImportToOrder,
  getLatestBookStockSummary,
  listBookStockImportsForStore,
  type BookStockImportSummary,
  type LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import { calculateOrder } from "@/services/order-calculation.service";
import { exportOrderToExcel } from "@/services/order-export.service";
import { importSupplierPriceRows } from "@/services/supplier-price-import.service";
import { processStockUpload } from "@/services/stock-upload.service";
import { recalculateLineCost } from "@/services/supplier-price.service";
import { parseAllRows, parseUploadedFile } from "@/parsers/file-parser";
import type { ActionResult, ImportResult } from "@/types";
import { decimalToDb, parseDbDecimal } from "@/utils/decimal";
import {
  barcodeSchema,
  applyStoredBookStockSchema,
  bookStockImportSchema,
  calculateOrderSchema,
  createOrderSchema,
  createProductSchema,
  createStoreSchema,
  createSupplierSchema,
  dailySalesImportSchema,
  exportOrderSchema,
  stockUploadSchema,
  storeProductSchema,
  supplierPriceImportSchema,
  supplierProductSchema,
  updateFinalQuantitySchema,
  updateOrderPeriodsSchema,
  updateOrderSuppliersSchema,
  updateProductSchema,
  updateStoreSchema,
  updateSupplierSchema,
  idSchema,
} from "@/validators/schemas";

function demoImportResult(rowCount: number): ImportResult {
  const matched = Math.max(0, rowCount - 1);
  return {
    totalRows: rowCount,
    matchedRows: matched,
    unmatchedRows: rowCount > matched ? 1 : 0,
    invalidRows: 0,
    errors:
      rowCount > matched
        ? [
            {
              rowNumber: 2,
              reference: "DEMO-001",
              message: "Demo mode: unmatched example row",
            },
          ]
        : [],
  };
}

export async function toggleStoreActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  await storeRepository.update(id, { isActive });
  revalidatePath("/stores");
  return { success: true, data: undefined };
}

export async function toggleSupplierActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  await supplierRepository.update(id, { isActive });
  revalidatePath("/stores");
  return { success: true, data: undefined };
}

export async function updateStoreDetails(input: unknown): Promise<ActionResult> {
  const parsed = updateStoreSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;
  await storeRepository.update(id, data);
  revalidatePath("/stores");
  return { success: true, data: undefined };
}

export async function updateSupplierDetails(input: unknown): Promise<ActionResult> {
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;
  await supplierRepository.update(id, data);
  revalidatePath("/stores");
  return { success: true, data: undefined };
}

export async function createStore(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createStoreSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const store = await storeRepository.create(parsed.data);
  return { success: true, data: { id: store.id } };
}

export async function updateStore(input: unknown): Promise<ActionResult> {
  const parsed = updateStoreSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;
  await storeRepository.update(id, data);
  revalidatePath("/stores");
  return { success: true, data: undefined };
}

export async function createSupplier(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const supplier = await supplierRepository.create(parsed.data);
  return { success: true, data: { id: supplier.id } };
}

export async function updateSupplier(input: unknown): Promise<ActionResult> {
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;
  await supplierRepository.update(id, data);
  return { success: true, data: undefined };
}

export async function createProduct(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const product = await productRepository.createProduct(parsed.data);
  return { success: true, data: { id: product.id } };
}

export async function updateProduct(input: unknown): Promise<ActionResult> {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;
  await productRepository.updateProduct(id, data);
  return { success: true, data: undefined };
}

export async function addStoreProduct(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = storeProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const row = await productRepository.addStoreProduct(parsed.data);
  return { success: true, data: { id: row.id } };
}

export async function addBarcode(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = barcodeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const row = await productRepository.addBarcode(parsed.data);
  return { success: true, data: { id: row.id } };
}

export async function addSupplierProductMapping(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = supplierProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const row = await productRepository.addSupplierProduct(parsed.data);
  return { success: true, data: { id: row.id } };
}

export async function previewUpload(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");
  const buffer = Buffer.from(await file.arrayBuffer());
  return parseUploadedFile(buffer, file.name);
}

export async function importDailySales(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = dailySalesImportSchema.safeParse({
    storeId: formData.get("storeId"),
    mappingType: formData.get("mappingType"),
    productColumn: formData.get("productColumn"),
    quantityColumn: formData.get("quantityColumn"),
    dateColumn: formData.get("dateColumn") || undefined,
    manualSalesDate: formData.get("manualSalesDate") || undefined,
    fileName: file.name,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);
  if (isDemoMode()) {
    return { success: true, data: demoImportResult(rows.length) };
  }
  const result = await importDailySalesRows({ ...meta.data, rows });
  return { success: true, data: result };
}

export async function importSupplierPrices(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = supplierPriceImportSchema.safeParse({
    supplierId: formData.get("supplierId"),
    referenceColumn: formData.get("referenceColumn"),
    priceColumn: formData.get("priceColumn"),
    effectiveDate: formData.get("effectiveDate"),
    fileName: file.name,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);
  if (isDemoMode()) {
    return { success: true, data: demoImportResult(rows.length) };
  }
  const result = await importSupplierPriceRows({ ...meta.data, rows });
  return { success: true, data: result };
}

export async function importBookStock(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = bookStockImportSchema.safeParse({
    storeId: formData.get("storeId"),
    bookStockDate: formData.get("bookStockDate"),
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);
  if (isDemoMode()) {
    return {
      success: true,
      data: { ...demoImportResult(rows.length), importId: Date.now() },
    };
  }

  const store = await storeRepository.getById(meta.data.storeId);
  const erpType = store?.erpType === "glopos" ? "glopos" : "msp";

  const result = await importBookStockRows({ ...meta.data, rows, erpType });
  revalidatePath("/book-stock");
  return { success: true, data: result };
}

export async function listBookStockImports(
  storeId: number,
): Promise<ActionResult<BookStockImportSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  if (isDemoMode()) {
    return { success: true, data: [] };
  }
  const imports = await listBookStockImportsForStore(parsed.data);
  return { success: true, data: imports };
}

export async function getLatestBookStockForStore(
  storeId: number,
): Promise<ActionResult<LatestBookStockSummary | null>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  if (isDemoMode()) {
    return { success: true, data: null };
  }
  const summary = await getLatestBookStockSummary(parsed.data);
  return { success: true, data: summary };
}

export async function applyStoredBookStockToOrder(
  input: unknown,
): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  const parsed = applyStoredBookStockSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  if (isDemoMode()) {
    return {
      success: true,
      data: { ...demoImportResult(10), uploadId: Date.now() },
    };
  }
  const result = await applyBookStockImportToOrder(parsed.data);
  return { success: true, data: result };
}

export async function createOrder(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const order = await orderRepository.create({
    ...parsed.data,
    status: "draft",
  });
  return { success: true, data: { id: order.id } };
}

export async function updateOrderPeriods(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateOrderPeriodsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  await orderRepository.replacePeriods(
    parsed.data.orderId,
    parsed.data.periods.map((p) => ({
      orderId: parsed.data.orderId,
      periodKey: p.periodKey,
      startDate: p.startDate,
      endDate: p.endDate,
    })),
  );
  return { success: true, data: undefined };
}

export async function updateOrderSelectedSuppliers(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateOrderSuppliersSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  await orderRepository.replacePriceSuppliers(
    parsed.data.orderId,
    parsed.data.supplierIds,
  );
  return { success: true, data: undefined };
}

export async function uploadOrderStockFile(
  formData: FormData,
): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = stockUploadSchema.safeParse({
    orderId: formData.get("orderId"),
    uploadType: formData.get("uploadType"),
    fileName: file.name,
    mappingType: formData.get("mappingType"),
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    supplierId: formData.get("supplierId") || undefined,
    deliveryDate: formData.get("deliveryDate") || undefined,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const order = await orderRepository.getById(meta.data.orderId);
  if (!order) return { success: false, error: "Order not found" };

  const store = await storeRepository.getById(order.storeId);
  const erpType = store?.erpType === "glopos" ? "glopos" : "msp";

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);
  if (isDemoMode()) {
    return {
      success: true,
      data: { ...demoImportResult(rows.length), uploadId: Date.now() },
    };
  }
  const result = await processStockUpload({
    ...meta.data,
    storeId: order.storeId,
    bookStockDate: order.bookStockDate,
    rows,
    erpType,
  });
  return { success: true, data: result };
}

export async function calculateOrderAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = calculateOrderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  if (isDemoMode()) {
    const mock = await import("@/repositories/mock");
    await mock.orderRepository.simulateCalculate(parsed.data.orderId);
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { success: true, data: undefined };
  }
  await calculateOrder(parsed.data.orderId);
  return { success: true, data: undefined };
}

export async function updateFinalOrderQuantity(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateFinalQuantitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const item = await orderRepository.getOrderItem(parsed.data.orderItemId);
  if (!item) return { success: false, error: "Order item not found" };

  const finalQty = parseDbDecimal(parsed.data.finalOrderQty);
  const estimatedLineCost = item.cheapestNetPrice
    ? decimalToDb(
        recalculateLineCost(finalQty, parseDbDecimal(item.cheapestNetPrice))!,
      )
    : null;

  await orderRepository.updateFinalQuantity(parsed.data.orderItemId, parsed.data.finalOrderQty);
  if (!isDemoMode() && estimatedLineCost !== null) {
    const { db } = await import("@/db");
    const { orderItems } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(orderItems)
      .set({ estimatedLineCost })
      .where(eq(orderItems.id, parsed.data.orderItemId));
  }

  return { success: true, data: undefined };
}

export async function exportOrder(
  input: unknown,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  const parsed = exportOrderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const buffer = await exportOrderToExcel(parsed.data.orderId);
  return {
    success: true,
    data: {
      base64: buffer.toString("base64"),
      fileName: `order-${parsed.data.orderId}.xlsx`,
    },
  };
}

export async function importProducts(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  const file = formData.get("file") as File | null;
  const parsedStoreId = idSchema.safeParse(formData.get("storeId"));
  if (!file || !parsedStoreId.success) {
    return { success: false, error: "Store and file are required" };
  }
  const storeId = parsedStoreId.data;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);

  const result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
  };

  for (const row of rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const name = row["Product Name"] ?? row["Name"] ?? row["name"] ?? "";
    const department = row["Department"] ?? row["department"] ?? "General";
    const storeCode =
      row["Store Code"] ?? row["Store Product Code"] ?? row["Code"] ?? "";

    if (!name || !storeCode) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: storeCode || null,
        message: "Missing product name or store code",
      });
      continue;
    }

    try {
      const product = await productRepository.createProduct({
        name,
        department,
        isActive: true,
      });
      await productRepository.addStoreProduct({
        storeId,
        productId: product.id,
        storeProductCode: storeCode,
        isActive: true,
      });
      result.matchedRows += 1;
    } catch (error) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: storeCode,
        message: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  return { success: true, data: result };
}
