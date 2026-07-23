"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
import { tryParseRetailSalesReport } from "@/parsers/glopos-retail-parser";
import {
  detectProductFileColumns,
  parseProductFile,
} from "@/parsers/product-file-parser";
import {
  IMPORT_JOB_BATCH_SIZE,
  importNormalizedRowsBatch,
  importProductRows,
  prepareProductImportJob,
} from "@/services/product-import.service";
import {
  deleteProductImportJob,
  getProductImportJob,
  saveProductImportJob,
} from "@/services/product-import-job-store";
import { exportHoDairyOrderToExcel, fillHoDairyTemplate } from "@/services/ho-dairy-export.service";
import type {
  ActionResult,
  FilePreview,
  ImportResult,
  ParsedRow,
  ProductImportBatchStatus,
  ProductImportProgress,
} from "@/types";
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

export async function previewDailySalesUpload(
  formData: FormData,
): Promise<
  FilePreview & {
    productColumn?: string;
    quantityColumn?: string;
    manualSalesDate?: string;
    periodLabel?: string | null;
    duplicateRows?: number;
  }
> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");

  const buffer = Buffer.from(await file.arrayBuffer());
  const retail = await tryParseRetailSalesReport(buffer, file.name);

  if (retail) {
    return {
      headers: retail.headers,
      rows: retail.rows.slice(0, 10),
      productColumn: retail.itemCodeColumn,
      quantityColumn: retail.salesQtyColumn,
      manualSalesDate: retail.salesDate ?? undefined,
      periodLabel: retail.periodLabel,
      duplicateRows: retail.duplicateRows,
    };
  }

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

  let rows;
  let importMeta = { ...meta.data };
  let duplicateRows = 0;

  const retail = await tryParseRetailSalesReport(buffer, file.name);
  if (retail) {
    rows = retail.rows;
    importMeta = {
      ...importMeta,
      productColumn: retail.itemCodeColumn,
      quantityColumn: retail.salesQtyColumn,
      mappingType: "store_product_code",
      manualSalesDate: retail.salesDate ?? importMeta.manualSalesDate,
    };
    duplicateRows = retail.duplicateRows;
  } else {
    ({ rows } = await parseAllRows(buffer, file.name));
  }

  if (isDemoMode()) {
    return {
      success: true,
      data: { ...demoImportResult(rows.length), duplicateRows },
    };
  }

  const result = await importDailySalesRows({ ...importMeta, rows });
  revalidatePath("/daily-sales");
  return { success: true, data: { ...result, duplicateRows: result.duplicateRows ?? duplicateRows } };
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

  const order = await orderRepository.getById(parsed.data.orderId);
  if (!order) return { success: false, error: "Order not found" };
  const store = await storeRepository.getById(order.storeId);

  const buffer =
    store?.erpType === "glopos"
      ? await exportHoDairyOrderToExcel(parsed.data.orderId)
      : await exportOrderToExcel(parsed.data.orderId);

  const fileName =
    store?.erpType === "glopos"
      ? `HO Dairy-order-${parsed.data.orderId}.xlsx`
      : `order-${parsed.data.orderId}.xlsx`;

  return {
    success: true,
    data: {
      base64: buffer.toString("base64"),
      fileName,
    },
  };
}

export async function exportHoDairyWithTemplate(
  formData: FormData,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  const orderId = idSchema.safeParse(formData.get("orderId"));
  if (!orderId.success) return { success: false, error: orderId.error.message };

  const template = formData.get("template") as File | null;
  if (!template) return { success: false, error: "HO Dairy template file is required" };

  const templateBuffer = Buffer.from(await template.arrayBuffer());
  const buffer = await fillHoDairyTemplate(orderId.data, templateBuffer);

  return {
    success: true,
    data: {
      base64: buffer.toString("base64"),
      fileName: `HO Dairy-filled-${orderId.data}.xlsx`,
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseProductFile(buffer, file.name);
  const columns = detectProductFileColumns(headers);

  if (!columns.codeColumn || !columns.nameColumn) {
    return {
      success: false,
      error:
        "Could not detect product columns. Expected ProductCode/ID and ItemName1/Name.",
    };
  }

  if (isDemoMode()) {
    return { success: true, data: demoImportResult(rows.length) };
  }

  const result = await importProductRows({
    storeId: parsedStoreId.data,
    codeColumn: columns.codeColumn,
    nameColumn: columns.nameColumn,
    departmentColumn: columns.departmentColumn ?? undefined,
    barcodeColumn: columns.barcodeColumn ?? undefined,
    shareAcrossMspStores: columns.shareAcrossMspStores,
    rows,
  });

  revalidatePath("/products");
  return { success: true, data: result };
}

const beginProductImportFromRowsSchema = z.object({
  storeId: z.number().int().positive(),
  fileName: z.string().min(1),
  codeColumn: z.string().min(1),
  nameColumn: z.string().min(1),
  departmentColumn: z.string().optional(),
  barcodeColumn: z.string().optional(),
  shareAcrossMspStores: z.boolean().optional(),
  rows: z.array(z.record(z.string(), z.string())).min(1),
});

async function createProductImportJob(input: {
  storeId: number;
  fileName: string;
  codeColumn: string;
  nameColumn: string;
  departmentColumn?: string;
  barcodeColumn?: string;
  shareAcrossMspStores?: boolean;
  rows: ParsedRow[];
}): Promise<ActionResult<ProductImportProgress>> {
  const store = await storeRepository.getById(input.storeId);
  if (!store) return { success: false, error: "Store not found" };

  if (isDemoMode()) {
    return {
      success: true,
      data: {
        jobId: "demo",
        totalRows: input.rows.length,
        fileName: input.fileName,
        storeName: store.name,
        batchSize: IMPORT_JOB_BATCH_SIZE,
      },
    };
  }

  const prepared = await prepareProductImportJob({
    storeId: input.storeId,
    codeColumn: input.codeColumn,
    nameColumn: input.nameColumn,
    departmentColumn: input.departmentColumn,
    barcodeColumn: input.barcodeColumn,
    shareAcrossMspStores: input.shareAcrossMspStores,
    rows: input.rows,
  });

  if (!prepared.normalizedRows.length) {
    return {
      success: false,
      error:
        prepared.result.invalidRows > 0
          ? `No valid products to import (${prepared.result.invalidRows.toLocaleString()} rows missing ID or Name).`
          : "No product rows found in the file.",
    };
  }

  const jobId = saveProductImportJob({
    storeId: input.storeId,
    storeName: store.name,
    fileName: input.fileName,
    shareAcrossMspStores: prepared.shareAcrossMspStores,
    normalizedRows: prepared.normalizedRows,
    result: prepared.result,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  return {
    success: true,
    data: {
      jobId,
      totalRows: prepared.normalizedRows.length,
      fileName: input.fileName,
      storeName: store.name,
      batchSize: IMPORT_JOB_BATCH_SIZE,
    },
  };
}

export async function beginProductImportFromRows(
  input: unknown,
): Promise<ActionResult<ProductImportProgress>> {
  const parsed = beginProductImportFromRowsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  return createProductImportJob(parsed.data);
}

export async function beginProductImport(
  formData: FormData,
): Promise<ActionResult<ProductImportProgress>> {
  const file = formData.get("file") as File | null;
  const parsedStoreId = idSchema.safeParse(formData.get("storeId"));
  if (!file || !parsedStoreId.success) {
    return { success: false, error: "Store and file are required" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseProductFile(buffer, file.name);
  const columns = detectProductFileColumns(headers);

  if (!columns.codeColumn || !columns.nameColumn) {
    return {
      success: false,
      error:
        "Could not detect product columns. Expected ProductCode/ID and ItemName1/Name.",
    };
  }

  return createProductImportJob({
    storeId: parsedStoreId.data,
    fileName: file.name,
    codeColumn: columns.codeColumn,
    nameColumn: columns.nameColumn,
    departmentColumn: columns.departmentColumn ?? undefined,
    barcodeColumn: columns.barcodeColumn ?? undefined,
    shareAcrossMspStores: columns.shareAcrossMspStores,
    rows,
  });
}

export async function runProductImportBatch(input: {
  jobId: string;
  batchIndex: number;
}): Promise<ActionResult<ProductImportBatchStatus>> {
  if (isDemoMode()) {
    return {
      success: true,
      data: {
        processed: input.batchIndex + 1,
        total: 1,
        done: true,
        result: demoImportResult(100),
      },
    };
  }

  const job = getProductImportJob(input.jobId);
  if (!job) {
    return { success: false, error: "Import session expired. Please upload the file again." };
  }

  const start = input.batchIndex * IMPORT_JOB_BATCH_SIZE;
  const batch = job.normalizedRows.slice(start, start + IMPORT_JOB_BATCH_SIZE);

  await importNormalizedRowsBatch({
    storeId: job.storeId,
    shareAcrossMspStores: job.shareAcrossMspStores,
    rows: batch,
    result: job.result,
  });

  const processed = Math.min(start + batch.length, job.normalizedRows.length);
  const done = processed >= job.normalizedRows.length;

  if (done) {
    deleteProductImportJob(input.jobId);
    revalidatePath("/products");
  }

  return {
    success: true,
    data: {
      processed,
      total: job.normalizedRows.length,
      done,
      result: job.result,
    },
  };
}

export async function finishProductImport(
  jobId: string,
): Promise<ActionResult<ImportResult>> {
  if (isDemoMode()) {
    return { success: true, data: demoImportResult(100) };
  }

  const job = getProductImportJob(jobId);
  if (!job) {
    return {
      success: false,
      error: "Import session expired. Please upload the file again.",
    };
  }

  if (!job.normalizedRows.length) {
    deleteProductImportJob(jobId);
    return {
      success: false,
      error: "No valid products found in the file. Check that ID and Name columns are present.",
    };
  }

  for (
    let start = 0;
    start < job.normalizedRows.length;
    start += IMPORT_JOB_BATCH_SIZE
  ) {
    const batch = job.normalizedRows.slice(start, start + IMPORT_JOB_BATCH_SIZE);
    await importNormalizedRowsBatch({
      storeId: job.storeId,
      shareAcrossMspStores: job.shareAcrossMspStores,
      rows: batch,
      result: job.result,
    });
  }

  deleteProductImportJob(jobId);
  revalidatePath("/products");
  return { success: true, data: job.result };
}
