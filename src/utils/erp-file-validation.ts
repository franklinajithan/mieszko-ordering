import { detectBookStockColumns } from "@/parsers/file-parser";
import { isGloposRtcHistoryReport } from "@/parsers/glopos-rtc-history-parser";
import { isGloposStockValuationReport } from "@/parsers/glopos-stock-valuation-parser";
import { isGloposWastageReport } from "@/parsers/glopos-wastage-report-parser";
import { isGloposStockVarianceWastageReport } from "@/parsers/glopos-stock-variance-wastage-parser";
import { isGloposRetailReport } from "@/parsers/glopos-retail-parser";
import { isMspPromotionItemDetailReport } from "@/parsers/msp-promotion-item-detail-parser";
import { detectProductFileColumns } from "@/parsers/product-file-parser";
import { BOOK_STOCK_COLUMNS } from "@/lib/import-config";
import type { ErpType } from "@/types";

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasHeader(headers: string[], patterns: string[]): boolean {
  const normalized = headers.map(normHeader);
  return patterns.some((pattern) => normalized.includes(normHeader(pattern)));
}

export function resolveStoreErpType(
  erpType: string | null | undefined,
): ErpType {
  return erpType === "glopos" ? "glopos" : "msp";
}

export function erpTypeLabel(erpType: ErpType): string {
  return erpType === "glopos" ? "GloPOS" : "MSP";
}

export function detectProductFileErpType(headers: string[]): ErpType | null {
  const columns = detectProductFileColumns(headers);

  if (columns.shareAcrossMspStores) return "msp";
  if (hasHeader(headers, ["ProductCode", "Product Code"])) return "msp";
  if (hasHeader(headers, ["ItemName1", "Item Name", "InnerEan", "Inner EAN"])) {
    return "msp";
  }

  if (hasHeader(headers, ["Item Code"])) return "glopos";
  if (
    hasHeader(headers, ["ID", "Id"]) &&
    hasHeader(headers, ["Name", "Description"]) &&
    !hasHeader(headers, ["ItemName1", "Item Name"])
  ) {
    return "glopos";
  }

  return null;
}

export function detectBookStockFileErpType(
  headers: string[],
  fileName = "",
): ErpType | null {
  if (isGloposStockValuationReport(headers, fileName)) return null;

  const hasItemCode = hasHeader(headers, BOOK_STOCK_COLUMNS.glopos.reference);
  const hasCurrentStock = headers.some((header) =>
    normHeader(header).includes("current stock"),
  );
  const hasId = hasHeader(headers, BOOK_STOCK_COLUMNS.msp.reference);
  const hasQty = hasHeader(headers, BOOK_STOCK_COLUMNS.msp.quantity);

  if (hasItemCode && hasCurrentStock) return "glopos";

  const gloposColumns = detectBookStockColumns(headers, "glopos");
  if (
    gloposColumns.referenceColumn &&
    gloposColumns.quantityColumn &&
    normHeader(gloposColumns.referenceColumn) === "item code" &&
    normHeader(gloposColumns.quantityColumn).includes("current stock")
  ) {
    return "glopos";
  }

  if (hasId && hasQty && !hasItemCode) return "msp";

  const mspColumns = detectBookStockColumns(headers, "msp");
  if (
    mspColumns.referenceColumn &&
    mspColumns.quantityColumn &&
    hasHeader([mspColumns.referenceColumn], BOOK_STOCK_COLUMNS.msp.reference) &&
    hasHeader([mspColumns.quantityColumn], BOOK_STOCK_COLUMNS.msp.quantity)
  ) {
    return "msp";
  }

  return null;
}

export function detectRtcFileErpType(
  headers: string[],
  fileName: string,
): ErpType | null {
  if (isGloposRtcHistoryReport(headers, fileName)) return null;
  return detectBookStockFileErpType(headers);
}

export function detectWastageFileErpType(
  headers: string[],
  fileName: string,
): ErpType | null {
  if (isGloposWastageReport(headers, fileName)) return null;
  // Sudbury / GloPOS stock variance (Barcode + QTY Variance) — accepted for GloPOS.
  if (isGloposStockVarianceWastageReport(headers, fileName)) return "glopos";
  // MSP Stock Adjustment reports are accepted for MSP stores (and auto-parsed).
  if (/stock\s*adjustment/i.test(fileName)) return "msp";
  if (
    hasHeader(headers, ["Item Code"]) &&
    hasHeader(headers, ["Qty"]) &&
    (hasHeader(headers, ["St. Before"]) || hasHeader(headers, ["Adj. Amt"]))
  ) {
    return "msp";
  }
  return detectBookStockFileErpType(headers);
}

export function detectPromoFileErpType(
  headers: string[],
  fileName: string,
): ErpType | null {
  // MSP Promotion Item Detail (Barcode + Promo Qty).
  if (isMspPromotionItemDetailReport(headers, fileName)) return "msp";
  return detectBookStockFileErpType(headers, fileName);
}

export function detectDailySalesFileErpType(
  headers: string[],
  fileName: string,
): ErpType | null {
  // Product Sales Enquiry / GloPOS retail reports match store products by Item Code.
  // They are accepted for any store ERP type (auto-parsed on import).
  if (isGloposRetailReport(headers, fileName)) return null;
  if (
    hasHeader(headers, ["Item Code"]) &&
    hasHeader(headers, ["Sales Qty", "Sales QTY", "Sales qty"])
  ) {
    return null;
  }

  if (
    hasHeader(headers, ["ID", "Id"]) &&
    hasHeader(headers, ["Qty", "QTY", "Quantity"]) &&
    !hasHeader(headers, ["Item Code"])
  ) {
    return "msp";
  }

  return null;
}

export function getErpFileMismatchError(
  fileErpType: ErpType,
  storeErpType: ErpType,
): string {
  return `${erpTypeLabel(fileErpType)} files can only be uploaded to ${erpTypeLabel(fileErpType)} stores. The selected store is ${erpTypeLabel(storeErpType)}. Choose a matching store or upload the correct file type.`;
}

export function validateErpFileMatch(
  fileErpType: ErpType | null,
  storeErpType: ErpType,
): string | null {
  if (!fileErpType || fileErpType === storeErpType) return null;
  return getErpFileMismatchError(fileErpType, storeErpType);
}

export function inferProductFileErpTypeFromColumns(input: {
  shareAcrossMspStores?: boolean;
  codeColumn: string;
  nameColumn: string;
}): ErpType | null {
  if (input.shareAcrossMspStores) return "msp";

  const code = normHeader(input.codeColumn);
  const name = normHeader(input.nameColumn);

  if (code === "productcode" || code === "product code") return "msp";
  if (name === "itemname1" || name === "item name") return "msp";
  if (code === "item code") return "glopos";
  if (code === "id" && (name === "name" || name === "description")) return "glopos";

  return null;
}

export function isErpMismatchMessage(message: string): boolean {
  return message.includes("can only be uploaded to");
}

export const ERP_MISMATCH_EVENT = "erp-file-mismatch";

/** Show a blocking modal for ERP mismatch (client only). */
export function reportErpMismatch(message: string): void {
  if (typeof window !== "undefined" && isErpMismatchMessage(message)) {
    window.dispatchEvent(new CustomEvent(ERP_MISMATCH_EVENT, { detail: message }));
  }
}
