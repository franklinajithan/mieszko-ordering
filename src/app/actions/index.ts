"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  dailySalesRepository,
  departmentRepository,
  orderRepository,
  productRepository,
  rtcRepository,
  rtcSalesRepository,
  storeRepository,
  storeWastageRepository,
  supplierRepository,
} from "@/repositories";
import { importDepartmentRows } from "@/services/department-import.service";
import {
  DAILY_SALES_IMPORT_BATCH_SIZE,
  importDailySalesBatch,
  importDailySalesRows,
  prepareDailySalesImport,
} from "@/services/daily-sales-import.service";
import {
  deleteDailySalesImportJob,
  getDailySalesImportJob,
  saveDailySalesImportJob,
} from "@/services/daily-sales-import-job-store";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importBookStockRows } from "@/services/book-stock-import.service";
import {
  importPromoRows,
  listPromoImportsForStore,
  type PromoImportSummary,
} from "@/services/promo-import.service";
import {
  importRtcRows,
  listRtcImportsForStore,
  type RtcImportSummary,
  RTC_IMPORT_BATCH_SIZE,
  RTC_ITEM_CODE_COLUMN,
  prepareRtcImport,
  importRtcQuantityBatch,
  buildGloposRtcPreviewWithStoreProductCodes,
  resolvePreparedRtcRowsFromBarcodesToStoreProductCodes,
  enrichGloposRtcRowsWithStoreProductCodes,
} from "@/services/rtc-import.service";
import {
  deleteRtcImportJob,
  getRtcImportJob,
  saveRtcImportJob,
} from "@/services/rtc-import-job-store";
import {
  importWastageRows,
  listWastageImportsForStore,
  buildGloposWastagePreviewWithStoreProductCodes,
  enrichGloposWastageRowsWithStoreProductCodes,
  type WastageImportSummary,
} from "@/services/wastage-import.service";
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
import { detectWastageColumns, parseAllRows, parseUploadedFile } from "@/parsers/file-parser";
import { tryParseGloposRtcHistoryReport, isGloposRtcHistoryReport, parseGloposRtcHistoryReport } from "@/parsers/glopos-rtc-history-parser";
import {
  isGloposWastageReport,
  parseGloposWastageReport,
  tryParseGloposWastageReport,
} from "@/parsers/glopos-wastage-report-parser";
import { tryParseRetailSalesReport } from "@/parsers/glopos-retail-parser";
import {
  detectBookStockFileErpType,
  detectDailySalesFileErpType,
  detectRtcFileErpType,
  detectWastageFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { exportHoDairyOrderToExcel, fillHoDairyTemplate } from "@/services/ho-dairy-export.service";
import type {
  ActionResult,
  FilePreview,
  ImportResult,
  ParsedRow,
} from "@/types";
import { decimalToDb, parseDbDecimal } from "@/utils/decimal";
import {
  barcodeSchema,
  applyStoredBookStockSchema,
  bookStockImportSchema,
  promoImportSchema,
  rtcImportSchema,
  wastageImportSchema,
  calculateOrderSchema,
  createOrderSchema,
  createProductSchema,
  createStoreSchema,
  createSupplierSchema,
  createDepartmentSchema,
  dailySalesImportSchema,
  departmentImportSchema,
  exportOrderSchema,
  stockUploadSchema,
  storeProductSchema,
  supplierPriceImportSchema,
  supplierProductSchema,
  updateFinalQuantitySchema,
  updateOrderPeriodsSchema,
  updateOrderSuppliersSchema,
  updateProductSchema,
  assignOrderDepartmentSchema,
  updateStoreSchema,
  updateSupplierSchema,
  updateDepartmentSchema,
  idSchema,
} from "@/validators/schemas";


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

export async function createDepartment(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createDepartmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const code = parsed.data.code?.trim();
  const department = await departmentRepository.create({
    name: parsed.data.name.trim(),
    code: code || null,
    isActive: parsed.data.isActive,
  });
  revalidatePath("/departments");
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: { id: department.id } };
}

export async function updateDepartmentDetails(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateDepartmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const { id, ...data } = parsed.data;
  const payload = {
    ...data,
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.code !== undefined
      ? { code: data.code.trim() || null }
      : {}),
  };

  const updated = await departmentRepository.update(id, payload);
  if (!updated) return { success: false, error: "Department not found" };

  revalidatePath("/departments");
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: undefined };
}

export async function toggleDepartmentActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  await departmentRepository.update(id, { isActive });
  revalidatePath("/departments");
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: undefined };
}

export async function importDepartments(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  const file = formData.get("file") as File | null;
  const nameColumn = String(formData.get("nameColumn") ?? "");
  const codeColumn = String(formData.get("codeColumn") ?? "");

  if (!file) {
    return { success: false, error: "File is required" };
  }
  if (!nameColumn) {
    return { success: false, error: "Name column is required" };
  }

  const parsedMeta = departmentImportSchema.safeParse({
    nameColumn,
    codeColumn: codeColumn || undefined,
    fileName: file.name,
  });
  if (!parsedMeta.success) {
    return { success: false, error: parsedMeta.error.message };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseAllRows(buffer, file.name);


  const result = await importDepartmentRows(rows, {
    nameColumn: parsedMeta.data.nameColumn,
    codeColumn: parsedMeta.data.codeColumn,
  });

  revalidatePath("/departments");
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: result };
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

  const department = parsed.data.department.trim();
  let orderDepartmentId = parsed.data.orderDepartment ?? null;
  if (orderDepartmentId == null) {
    orderDepartmentId = await departmentRepository.ensureIdByName(department);
  } else {
    const known = await departmentRepository.getById(orderDepartmentId);
    if (!known || !known.isActive) {
      return {
        success: false,
        error: "Choose an active department from the departments list",
      };
    }
  }

  const product = await productRepository.createProduct({
    name: parsed.data.name,
    department,
    orderDepartment: orderDepartmentId,
    isActive: parsed.data.isActive,
  });
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: { id: product.id } };
}

export async function updateProduct(input: unknown): Promise<ActionResult> {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { id, ...data } = parsed.data;

  // Imported/source department can be edited manually, but order department is separate.
  if (data.department !== undefined) {
    data.department = data.department.trim();
  }
  if (data.orderDepartment !== undefined) {
    if (data.orderDepartment == null) {
      data.orderDepartment = null;
    } else {
      const known = await departmentRepository.getById(data.orderDepartment);
      if (!known || !known.isActive) {
        return {
          success: false,
          error: "Choose an active department from the departments list",
        };
      }
    }
  }

  await productRepository.updateProduct(id, data);
  revalidatePath("/products");
  revalidatePath("/orders/new");
  return { success: true, data: undefined };
}

/** Assign ordering department without changing the imported department value. */
export async function assignOrderDepartment(
  input: unknown,
): Promise<ActionResult> {
  const parsed = assignOrderDepartmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const orderDepartmentId = parsed.data.orderDepartment;
  if (orderDepartmentId != null) {
    const known = await departmentRepository.getById(orderDepartmentId);
    if (!known || !known.isActive) {
      return {
        success: false,
        error: "Choose an active department from the departments list",
      };
    }
  }

  const updated = await productRepository.assignOrderDepartment(
    parsed.data.productId,
    orderDepartmentId,
  );
  if (!updated) return { success: false, error: "Product not found" };

  revalidatePath("/products");
  revalidatePath(`/products/${parsed.data.productId}`);
  revalidatePath("/orders/new");
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

  const storeProduct = await productRepository.findStoreProductForProduct(
    parsed.data.productId,
    parsed.data.storeId,
  );
  if (!storeProduct) {
    return { success: false, error: "Store product not found for this product and store" };
  }

  const row = await productRepository.addBarcodeIfAbsent({
    storeId: parsed.data.storeId,
    storeProductId: storeProduct.id,
    barcode: parsed.data.barcode,
  });
  if (!row) {
    return { success: false, error: "Barcode already exists for this store" };
  }
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

  const preview =
    retail ?
      {
        headers: retail.headers,
        rows: retail.rows.slice(0, 10),
        productColumn: retail.itemCodeColumn,
        quantityColumn: retail.salesQtyColumn,
        manualSalesDate: retail.salesDate ?? undefined,
        periodLabel: retail.periodLabel,
        duplicateRows: retail.duplicateRows,
      }
    : await parseUploadedFile(buffer, file.name);

  const storeId = idSchema.safeParse(formData.get("storeId"));
  if (storeId.success) {
    const store = await storeRepository.getById(storeId.data);
    if (store) {
      const storeErpType = resolveStoreErpType(store.erpType);
      const fileErpType = detectDailySalesFileErpType(
        preview.headers,
        file.name,
      );
      const mismatch = validateErpFileMatch(fileErpType, storeErpType);
      if (mismatch) throw new Error(mismatch);
    }
  }

  return preview;
}

export async function previewRtcUpload(
  formData: FormData,
): Promise<
  FilePreview & {
    referenceColumn?: string;
    quantityColumn?: string;
    rtcDate?: string;
    duplicateRows?: number;
    mappingType?: "store_product_code" | "barcode";
    matchedCount?: number;
    unmatchedCount?: number;
    unmatchedBarcodes?: string[];
  }
> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");

  const buffer = Buffer.from(await file.arrayBuffer());
  const gloposRtc = await tryParseGloposRtcHistoryReport(buffer, file.name);

  const storeId = idSchema.safeParse(formData.get("storeId"));

  let preview: FilePreview & {
    referenceColumn?: string;
    quantityColumn?: string;
    rtcDate?: string;
    duplicateRows?: number;
    mappingType?: "store_product_code" | "barcode";
  };

  if (gloposRtc && storeId.success) {
    const enriched = await buildGloposRtcPreviewWithStoreProductCodes(
      storeId.data,
      gloposRtc,
    );
    preview = {
      ...enriched,
      rows: enriched.rows.slice(0, 10),
    };
  } else if (gloposRtc) {
    preview = {
      headers: gloposRtc.headers,
      rows: gloposRtc.rows.slice(0, 10),
      referenceColumn: gloposRtc.barcodeColumn,
      quantityColumn: gloposRtc.quantityColumn,
      rtcDate: gloposRtc.rtcDate ?? undefined,
      duplicateRows: gloposRtc.duplicateRows,
      mappingType: "barcode" as const,
    };
  } else {
    preview = await parseUploadedFile(buffer, file.name);
  }

  if (storeId.success) {
    const store = await storeRepository.getById(storeId.data);
    if (store) {
      const storeErpType = resolveStoreErpType(store.erpType);
      const fileErpType = detectRtcFileErpType(preview.headers, file.name);
      const mismatch = validateErpFileMatch(fileErpType, storeErpType);
      if (mismatch) throw new Error(mismatch);
    }
  }

  return preview;
}

export async function previewWastageUpload(
  formData: FormData,
): Promise<
  FilePreview & {
    referenceColumn?: string;
    quantityColumn?: string;
    wastageDate?: string;
    duplicateRows?: number;
    mappingType?: "store_product_code" | "barcode";
    skippedExcludedReasonRows?: number;
    matchedCount?: number;
    unmatchedCount?: number;
    unmatchedCodes?: string[];
  }
> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");

  const buffer = Buffer.from(await file.arrayBuffer());
  let gloposWastage = await tryParseGloposWastageReport(buffer, file.name);
  if (!gloposWastage && isGloposWastageReport([], file.name)) {
    try {
      gloposWastage = await parseGloposWastageReport(buffer, file.name);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Failed to parse GloPOS wastage file",
      );
    }
  }

  let preview: FilePreview & {
    referenceColumn?: string;
    quantityColumn?: string;
    wastageDate?: string;
    duplicateRows?: number;
    mappingType?: "store_product_code" | "barcode";
    skippedExcludedReasonRows?: number;
    matchedCount?: number;
    unmatchedCount?: number;
    unmatchedCodes?: string[];
  };

  if (gloposWastage) {
    preview = {
      headers: gloposWastage.headers,
      rows: gloposWastage.rows.slice(0, 10),
      referenceColumn: gloposWastage.productCodeColumn,
      quantityColumn: gloposWastage.quantityColumn,
      wastageDate: gloposWastage.wastageDate ?? undefined,
      duplicateRows: gloposWastage.duplicateRows,
      mappingType: "store_product_code",
      skippedExcludedReasonRows: gloposWastage.skippedExcludedReasonRows,
    };
    const storeId = idSchema.safeParse(formData.get("storeId"));
    if (storeId.success) {
      const enriched = await buildGloposWastagePreviewWithStoreProductCodes(
        storeId.data,
        gloposWastage,
      );
      preview = {
        ...enriched,
        rows: enriched.rows.slice(0, 10),
        skippedExcludedReasonRows: gloposWastage.skippedExcludedReasonRows,
      };
    }
  } else {
    preview = await parseUploadedFile(buffer, file.name);
    const storeId = idSchema.safeParse(formData.get("storeId"));
    if (storeId.success) {
      const store = await storeRepository.getById(storeId.data);
      if (store) {
        const detected = detectWastageColumns(preview.headers, resolveStoreErpType(store.erpType));
        preview = {
          ...preview,
          referenceColumn: detected.referenceColumn ?? undefined,
          quantityColumn: detected.quantityColumn ?? undefined,
        };
      }
    }
  }

  const storeId = idSchema.safeParse(formData.get("storeId"));
  if (storeId.success) {
    const store = await storeRepository.getById(storeId.data);
    if (store) {
      const storeErpType = resolveStoreErpType(store.erpType);
      const fileErpType = detectWastageFileErpType(preview.headers, file.name);
      const mismatch = validateErpFileMatch(fileErpType, storeErpType);
      if (mismatch) throw new Error(mismatch);
    }
  }

  return preview;
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

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());

  let rows;
  let importMeta = { ...meta.data };
  let duplicateRows = 0;
  let previewHeaders: string[] = [];

  const retail = await tryParseRetailSalesReport(buffer, file.name);
  if (retail) {
    rows = retail.rows;
    previewHeaders = retail.headers;
    importMeta = {
      ...importMeta,
      productColumn: retail.itemCodeColumn,
      quantityColumn: retail.salesQtyColumn,
      mappingType: "store_product_code",
      manualSalesDate: importMeta.manualSalesDate ?? retail.salesDate ?? undefined,
    };
    duplicateRows = retail.duplicateRows;
  } else {
    const parsed = await parseAllRows(buffer, file.name);
    rows = parsed.rows;
    previewHeaders = parsed.headers;
  }

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = detectDailySalesFileErpType(previewHeaders, file.name);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return { success: false, error: mismatch };


  const result = await importDailySalesRows({ ...importMeta, rows });
  revalidatePath("/daily-sales");
  return { success: true, data: { ...result, duplicateRows: result.duplicateRows ?? duplicateRows } };
}

export async function beginDailySalesImport(
  formData: FormData,
): Promise<
  ActionResult<{
    jobId: string;
    totalRows: number;
    fileName: string;
    storeName: string;
    batchSize: number;
  }>
> {
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

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const retail = await tryParseRetailSalesReport(buffer, file.name);
  let rows: ParsedRow[];
  let importMeta = { ...meta.data };
  let previewHeaders: string[];

  if (retail) {
    rows = retail.rows;
    previewHeaders = retail.headers;
    importMeta = {
      ...importMeta,
      productColumn: retail.itemCodeColumn,
      quantityColumn: retail.salesQtyColumn,
      mappingType: "store_product_code",
      manualSalesDate: importMeta.manualSalesDate ?? retail.salesDate ?? undefined,
    };
  } else {
    const parsed = await parseAllRows(buffer, file.name);
    rows = parsed.rows;
    previewHeaders = parsed.headers;
  }

  const mismatch = validateErpFileMatch(
    detectDailySalesFileErpType(previewHeaders, file.name),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) return { success: false, error: mismatch };

  const prepared = prepareDailySalesImport({ ...importMeta, rows });
  if (!prepared.sales.length) {
    return {
      success: false,
      error: "No valid daily-sales rows found in the file.",
    };
  }

  const jobId = saveDailySalesImportJob({
    storeId: importMeta.storeId,
    storeName: store.name,
    fileName: file.name,
    mappingType: importMeta.mappingType,
    sales: prepared.sales,
    result: prepared.result,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  return {
    success: true,
    data: {
      jobId,
      totalRows: prepared.sales.length,
      fileName: file.name,
      storeName: store.name,
      batchSize: DAILY_SALES_IMPORT_BATCH_SIZE,
    },
  };
}

export async function runDailySalesImportBatch(input: {
  jobId: string;
  batchIndex: number;
}): Promise<
  ActionResult<{
    processed: number;
    total: number;
    done: boolean;
    result: ImportResult;
  }>
> {
  const job = getDailySalesImportJob(input.jobId);
  if (!job) {
    return {
      success: false,
      error: "Import session expired. Please upload the file again.",
    };
  }

  const start = input.batchIndex * DAILY_SALES_IMPORT_BATCH_SIZE;
  const sales = job.sales.slice(start, start + DAILY_SALES_IMPORT_BATCH_SIZE);
  await importDailySalesBatch({
    storeId: job.storeId,
    mappingType: job.mappingType,
    sales,
    result: job.result,
  });

  const processed = Math.min(start + sales.length, job.sales.length);
  const done = processed >= job.sales.length;
  if (done) {
    deleteDailySalesImportJob(input.jobId);
    revalidatePath("/daily-sales");
  }

  return {
    success: true,
    data: { processed, total: job.sales.length, done, result: job.result },
  };
}

export async function deleteDailySalesUpload(
  storeId: number,
  salesDate: string,
): Promise<ActionResult<void>> {
  const parsedStore = idSchema.safeParse(storeId);
  if (!parsedStore.success) {
    return { success: false, error: parsedStore.error.message };
  }
  const parsedDate = z.string().date().safeParse(salesDate);
  if (!parsedDate.success) {
    return { success: false, error: parsedDate.error.message };
  }

  await dailySalesRepository.deleteForStoreAndDate(
    parsedStore.data,
    parsedDate.data,
  );
  revalidatePath("/daily-sales");
  return { success: true, data: undefined };
}

export type DailySalesStoreSummary = {
  salesDate: string;
  itemCount: number;
  totalSoldQty: string;
  lastUpdated: string;
};

export async function listDailySalesSummaries(
  storeId: number,
): Promise<ActionResult<DailySalesStoreSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const rows = await dailySalesRepository.listDateSummariesForStore(parsed.data);
  return {
    success: true,
    data: rows.map((row) => ({
      salesDate: row.salesDate,
      itemCount: row.itemCount,
      totalSoldQty: String(row.totalSoldQty),
      lastUpdated: String(row.lastUpdated),
    })),
  };
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

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseAllRows(buffer, file.name);

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = detectBookStockFileErpType(headers);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return { success: false, error: mismatch };


  const erpType = storeErpType;

  const result = await importBookStockRows({ ...meta.data, rows, erpType });
  revalidatePath("/book-stock");
  return { success: true, data: result };
}

async function resolveRtcImportFromFile(
  file: File,
  meta: z.infer<typeof rtcImportSchema>,
): Promise<
  | { success: false; error: string }
  | {
      success: true;
      rows: ParsedRow[];
      importMeta: z.infer<typeof rtcImportSchema>;
      previewHeaders: string[];
      skipReferencePivot: boolean;
      storeErpType: ReturnType<typeof resolveStoreErpType>;
    }
> {
  const store = await storeRepository.getById(meta.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());

  let gloposRtc = await tryParseGloposRtcHistoryReport(buffer, file.name);
  if (!gloposRtc && isGloposRtcHistoryReport([], file.name)) {
    try {
      gloposRtc = await parseGloposRtcHistoryReport(buffer, file.name);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to parse GloPOS RTC file",
      };
    }
  }

  let rows: ParsedRow[];
  let importMeta = { ...meta };
  let previewHeaders: string[] = [];
  let skipReferencePivot = false;

  if (gloposRtc) {
    if (!gloposRtc.rows.length) {
      return { success: false, error: "No RTC product rows found in the file." };
    }

    const enriched = await enrichGloposRtcRowsWithStoreProductCodes(
      meta.storeId,
      gloposRtc,
    );
    if (!enriched.rows.length) {
      const sample = enriched.unmatchedBarcodes.slice(0, 5).join(", ");
      return {
        success: false,
        error:
          enriched.unmatchedBarcodes.length ?
            `No store products found for file barcodes (${enriched.unmatchedBarcodes.length} unmatched${sample ? `: ${sample}` : ""}). Add these barcodes to products in the catalog for this store, then preview again.`
          : "No RTC product rows found in the file.",
      };
    }

    rows = enriched.rows;
    previewHeaders = [RTC_ITEM_CODE_COLUMN, gloposRtc.quantityColumn];
    skipReferencePivot = true;
    importMeta = {
      ...importMeta,
      referenceColumn: RTC_ITEM_CODE_COLUMN,
      quantityColumn: gloposRtc.quantityColumn,
      mappingType: "store_product_code",
      rtcDate: importMeta.rtcDate || gloposRtc.rtcDate || meta.rtcDate,
    };
  } else {
    const parsed = await parseAllRows(buffer, file.name);
    rows = parsed.rows;
    previewHeaders = parsed.headers;
  }

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = detectRtcFileErpType(previewHeaders, file.name);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return { success: false, error: mismatch };

  return {
    success: true,
    rows,
    importMeta,
    previewHeaders,
    skipReferencePivot,
    storeErpType,
  };
}

export async function beginRtcImport(
  formData: FormData,
): Promise<
  ActionResult<{
    jobId: string;
    totalRows: number;
    fileName: string;
    storeName: string;
    batchSize: number;
    importId: number;
  }>
> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = rtcImportSchema.safeParse({
    storeId: formData.get("storeId"),
    rtcDate: formData.get("rtcDate"),
    mappingType:
      formData.get("mappingType") === "barcode" ? "barcode" : "store_product_code",
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
  });
  if (!meta.success) return { success: false, error: meta.error.message };

  const resolved = await resolveRtcImportFromFile(file, meta.data);
  if (!resolved.success) return { success: false, error: resolved.error };

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) return { success: false, error: "Store not found" };

  let rows = resolved.rows;
  if (resolved.storeErpType === "glopos" && !resolved.skipReferencePivot) {
    rows = pivotBookStockByReference(
      rows,
      resolved.importMeta.referenceColumn,
      resolved.importMeta.quantityColumn,
    ).rows;
  }

  const prepared = prepareRtcImport({
    referenceColumn: resolved.importMeta.referenceColumn,
    quantityColumn: resolved.importMeta.quantityColumn,
    rows,
  });

  if (!prepared.rows.length) {
    return {
      success: false,
      error: "No valid RTC rows found in the file.",
    };
  }

  let jobRows = prepared.rows;
  let jobMappingType = resolved.importMeta.mappingType;
  let referenceColumnForImport = resolved.importMeta.referenceColumn;
  if (resolved.skipReferencePivot && resolved.importMeta.mappingType === "barcode") {
    const remapped = await resolvePreparedRtcRowsFromBarcodesToStoreProductCodes(
      resolved.importMeta.storeId,
      prepared,
    );
    jobRows = remapped.rows;
    jobMappingType = "store_product_code";
    referenceColumnForImport = RTC_ITEM_CODE_COLUMN;
    prepared.result = remapped.result;
  }

  if (!jobRows.length) {
    return {
      success: false,
      error:
        "No RTC rows matched store products. Link file barcodes to products in the catalog (product barcodes + store item codes), then try again.",
    };
  }

  const rtcImport = await rtcRepository.createImport({
    storeId: resolved.importMeta.storeId,
    rtcDate: resolved.importMeta.rtcDate,
    referenceColumn: referenceColumnForImport,
    quantityColumn: resolved.importMeta.quantityColumn,
  });

  const jobId = saveRtcImportJob({
    storeId: resolved.importMeta.storeId,
    storeName: store.name,
    fileName: file.name,
    rtcDate: resolved.importMeta.rtcDate,
    mappingType: jobMappingType,
    importId: rtcImport.id,
    rows: jobRows,
    result: prepared.result,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  return {
    success: true,
    data: {
      jobId,
      totalRows: jobRows.length,
      fileName: file.name,
      storeName: store.name,
      batchSize: RTC_IMPORT_BATCH_SIZE,
      importId: rtcImport.id,
    },
  };
}

export async function runRtcImportBatch(input: {
  jobId: string;
  batchIndex: number;
}): Promise<
  ActionResult<{
    processed: number;
    total: number;
    done: boolean;
    result: ImportResult;
    importId: number;
  }>
> {
  const job = getRtcImportJob(input.jobId);
  if (!job) {
    return {
      success: false,
      error: "Import session expired. Please upload the file again.",
    };
  }

  const start = input.batchIndex * RTC_IMPORT_BATCH_SIZE;
  const batchRows = job.rows.slice(start, start + RTC_IMPORT_BATCH_SIZE);
  await importRtcQuantityBatch({
    storeId: job.storeId,
    rtcDate: job.rtcDate,
    mappingType: job.mappingType,
    rows: batchRows,
    result: job.result,
  });

  const processed = Math.min(start + batchRows.length, job.rows.length);
  const done = processed >= job.rows.length;
  if (done) {
    await rtcRepository.updateMatchedRows(job.importId, job.result.matchedRows);
    deleteRtcImportJob(input.jobId);
    revalidatePath("/rtc");
  }

  return {
    success: true,
    data: {
      processed,
      total: job.rows.length,
      done,
      result: job.result,
      importId: job.importId,
    },
  };
}

export async function importRtc(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = rtcImportSchema.safeParse({
    storeId: formData.get("storeId"),
    rtcDate: formData.get("rtcDate"),
    mappingType:
      formData.get("mappingType") === "barcode" ? "barcode" : "store_product_code",
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const resolved = await resolveRtcImportFromFile(file, meta.data);
  if (!resolved.success) return { success: false, error: resolved.error };

  const result = await importRtcRows({
    ...resolved.importMeta,
    rows: resolved.rows,
    erpType: resolved.storeErpType,
    skipReferencePivot: resolved.skipReferencePivot,
  });
  revalidatePath("/rtc");
  return { success: true, data: result };
}

export async function listRtcImports(
  storeId: number,
): Promise<ActionResult<RtcImportSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const imports = await listRtcImportsForStore(parsed.data);
  return { success: true, data: imports };
}

export type RtcStoreSummary = {
  rtcDate: string;
  itemCount: number;
  totalRtcQty: string;
  lastUpdated: string;
};

export async function listRtcSummaries(
  storeId: number,
): Promise<ActionResult<RtcStoreSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const rows = await rtcSalesRepository.listDateSummariesForStore(parsed.data);
  return {
    success: true,
    data: rows.map((row) => ({
      rtcDate: row.rtcDate,
      itemCount: row.itemCount,
      totalRtcQty: String(row.totalRtcQty),
      lastUpdated: String(row.lastUpdated),
    })),
  };
}

export async function deleteRtcUpload(
  storeId: number,
  rtcDate: string,
): Promise<ActionResult<void>> {
  const parsedStore = idSchema.safeParse(storeId);
  if (!parsedStore.success) {
    return { success: false, error: parsedStore.error.message };
  }
  const parsedDate = z.string().date().safeParse(rtcDate);
  if (!parsedDate.success) {
    return { success: false, error: parsedDate.error.message };
  }

  await rtcSalesRepository.deleteForStoreAndDate(parsedStore.data, parsedDate.data);
  revalidatePath("/rtc");
  return { success: true, data: undefined };
}

async function resolveWastageImportFromFile(
  file: File,
  meta: z.infer<typeof wastageImportSchema>,
): Promise<
  | { success: false; error: string }
  | {
      success: true;
      rows: ParsedRow[];
      importMeta: z.infer<typeof wastageImportSchema>;
      previewHeaders: string[];
      skipReferencePivot: boolean;
      storeErpType: ReturnType<typeof resolveStoreErpType>;
    }
> {
  const store = await storeRepository.getById(meta.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());

  let gloposWastage = await tryParseGloposWastageReport(buffer, file.name);
  if (!gloposWastage && isGloposWastageReport([], file.name)) {
    try {
      gloposWastage = await parseGloposWastageReport(buffer, file.name);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to parse GloPOS wastage file",
      };
    }
  }

  let rows: ParsedRow[];
  let importMeta = { ...meta };
  let previewHeaders: string[] = [];
  let skipReferencePivot = false;

  if (gloposWastage) {
    if (!gloposWastage.rows.length) {
      return { success: false, error: "No wastage product rows found in the file." };
    }

    const enriched = await enrichGloposWastageRowsWithStoreProductCodes(
      meta.storeId,
      gloposWastage,
    );
    if (!enriched.rows.length) {
      const sample = enriched.unmatchedCodes.slice(0, 5).join(", ");
      return {
        success: false,
        error:
          enriched.unmatchedCodes.length ?
            `No store products matched the file (${enriched.unmatchedCodes.length} unmatched${sample ? `: ${sample}` : ""}). Import the product catalog for this store first, then try again.`
          : "No wastage product rows found in the file.",
      };
    }

    rows = enriched.rows;
    previewHeaders = gloposWastage.headers;
    skipReferencePivot = true;
    importMeta = {
      ...importMeta,
      referenceColumn: gloposWastage.productCodeColumn,
      quantityColumn: gloposWastage.quantityColumn,
      mappingType: "store_product_code",
      wastageDate:
        importMeta.wastageDate || gloposWastage.wastageDate || meta.wastageDate,
    };
  } else {
    const parsed = await parseAllRows(buffer, file.name);
    rows = parsed.rows;
    previewHeaders = parsed.headers;
  }

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = detectWastageFileErpType(previewHeaders, file.name);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return { success: false, error: mismatch };

  return {
    success: true,
    rows,
    importMeta,
    previewHeaders,
    skipReferencePivot,
    storeErpType,
  };
}

export async function importWastage(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = wastageImportSchema.safeParse({
    storeId: formData.get("storeId"),
    wastageDate: formData.get("wastageDate"),
    mappingType: formData.get("mappingType") || "store_product_code",
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const resolved = await resolveWastageImportFromFile(file, meta.data);
  if (!resolved.success) return { success: false, error: resolved.error };

  const result = await importWastageRows({
    ...resolved.importMeta,
    rows: resolved.rows,
    erpType: resolved.storeErpType,
    skipReferencePivot: resolved.skipReferencePivot,
  });
  revalidatePath("/wastage");
  return { success: true, data: result };
}

export async function listWastageImports(
  storeId: number,
): Promise<ActionResult<WastageImportSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const imports = await listWastageImportsForStore(parsed.data);
  return { success: true, data: imports };
}

export type WastageStoreSummary = {
  wastageDate: string;
  itemCount: number;
  totalWastageQty: string;
  lastUpdated: string;
};

export async function listWastageSummaries(
  storeId: number,
): Promise<ActionResult<WastageStoreSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const rows = await storeWastageRepository.listDateSummariesForStore(parsed.data);
  return {
    success: true,
    data: rows.map((row) => ({
      wastageDate: row.wastageDate,
      itemCount: row.itemCount,
      totalWastageQty: String(row.totalWastageQty),
      lastUpdated: String(row.lastUpdated),
    })),
  };
}

export async function deleteWastageUpload(
  storeId: number,
  wastageDate: string,
): Promise<ActionResult<void>> {
  const parsedStore = idSchema.safeParse(storeId);
  if (!parsedStore.success) {
    return { success: false, error: parsedStore.error.message };
  }
  const parsedDate = z.string().date().safeParse(wastageDate);
  if (!parsedDate.success) {
    return { success: false, error: parsedDate.error.message };
  }

  await storeWastageRepository.deleteForStoreAndDate(parsedStore.data, parsedDate.data);
  revalidatePath("/wastage");
  return { success: true, data: undefined };
}

export async function importPromo(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "No file uploaded" };

  const meta = promoImportSchema.safeParse({
    storeId: formData.get("storeId"),
    promoDate: formData.get("promoDate"),
    mappingType: formData.get("mappingType") || "store_product_code",
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });

  if (!meta.success) return { success: false, error: meta.error.message };

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) return { success: false, error: "Store not found" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseAllRows(buffer, file.name);

  const storeErpType = resolveStoreErpType(store.erpType);
  const fileErpType = detectBookStockFileErpType(headers);
  const mismatch = validateErpFileMatch(fileErpType, storeErpType);
  if (mismatch) return { success: false, error: mismatch };


  const result = await importPromoRows({
    ...meta.data,
    rows,
    erpType: storeErpType,
  });
  revalidatePath("/promo-sales");
  return { success: true, data: result };
}

export async function listPromoImports(
  storeId: number,
): Promise<ActionResult<PromoImportSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const imports = await listPromoImportsForStore(parsed.data);
  return { success: true, data: imports };
}

export async function listBookStockImports(
  storeId: number,
): Promise<ActionResult<BookStockImportSummary[]>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const imports = await listBookStockImportsForStore(parsed.data);
  return { success: true, data: imports };
}

export async function getLatestBookStockForStore(
  storeId: number,
): Promise<ActionResult<LatestBookStockSummary | null>> {
  const parsed = idSchema.safeParse(storeId);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const summary = await getLatestBookStockSummary(parsed.data);
  return { success: true, data: summary };
}

export async function applyStoredBookStockToOrder(
  input: unknown,
): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  const parsed = applyStoredBookStockSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const result = await applyBookStockImportToOrder(parsed.data);
  return { success: true, data: result };
}

export async function createOrder(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const { departmentFilters, ...rest } = parsed.data;
  const order = await orderRepository.create({
    ...rest,
    departmentFilters: departmentFilters.map(String),
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
  if (!store) return { success: false, error: "Store not found" };
  const erpType = resolveStoreErpType(store.erpType);

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseAllRows(buffer, file.name);

  if (meta.data.uploadType === "book_stock") {
    const fileErpType = detectBookStockFileErpType(headers);
    const mismatch = validateErpFileMatch(fileErpType, erpType);
    if (mismatch) return { success: false, error: mismatch };
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
  if (estimatedLineCost !== null) {
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
