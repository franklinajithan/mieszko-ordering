import { Decimal, toDecimal } from "@/utils/decimal";
import type { PriceStatus, PriceValidationStatus } from "@/types";

export type SupplierPriceInput = {
  supplierId: number;
  supplierKey: string;
  supplierCode: string;
  supplierName: string;
  priceTiePriority: number;
  hasMapping: boolean;
  netPrice: string | null;
  caseSize: string | null;
};

export type SupplierPriceSnapshot = {
  supplierId: number;
  supplierKey: string;
  supplierName: string;
  supplierCode: string | null;
  netPrice: string | null;
  caseSize: string | null;
  priceValidationStatus: PriceValidationStatus;
  isCheapest: boolean;
  failureReason: string | null;
};

export type SupplierPriceComparisonResult = {
  priceStatus: PriceStatus;
  cheapestSupplierId: number | null;
  cheapestNetPrice: Decimal | null;
  estimatedLineCost: Decimal | null;
  warning: string | null;
  snapshots: SupplierPriceSnapshot[];
};

function validatePrice(netPrice: string | null): PriceValidationStatus {
  if (netPrice === null || netPrice.trim() === "") return "missing_price";
  const value = toDecimal(netPrice);
  if (!value.isFinite()) return "invalid_price";
  if (value.isZero() || value.isNegative()) return "invalid_price";
  return "valid";
}

export function compareSupplierPrices(
  suppliers: SupplierPriceInput[],
  finalOrderQty: Decimal,
): SupplierPriceComparisonResult {
  const snapshots: SupplierPriceSnapshot[] = suppliers.map((supplier) => {
    if (!supplier.hasMapping) {
      return {
        supplierId: supplier.supplierId,
        supplierKey: supplier.supplierKey,
        supplierName: supplier.supplierName,
        supplierCode: null,
        netPrice: null,
        caseSize: null,
        priceValidationStatus: "missing_code",
        isCheapest: false,
        failureReason: `${supplier.supplierName}: missing supplier product code mapping`,
      };
    }

    const priceStatus = validatePrice(supplier.netPrice);
    if (priceStatus !== "valid") {
      const reason =
        priceStatus === "missing_price"
          ? `${supplier.supplierName}: missing net price`
          : `${supplier.supplierName}: invalid net price (${supplier.netPrice ?? "blank"})`;
      return {
        supplierId: supplier.supplierId,
        supplierKey: supplier.supplierKey,
        supplierName: supplier.supplierName,
        supplierCode: supplier.supplierCode,
        netPrice: supplier.netPrice,
        caseSize: supplier.caseSize,
        priceValidationStatus: priceStatus,
        isCheapest: false,
        failureReason: reason,
      };
    }

    return {
      supplierId: supplier.supplierId,
      supplierKey: supplier.supplierKey,
      supplierName: supplier.supplierName,
      supplierCode: supplier.supplierCode,
      netPrice: supplier.netPrice,
      caseSize: supplier.caseSize,
      priceValidationStatus: "valid",
      isCheapest: false,
      failureReason: null,
    };
  });

  const invalid = snapshots.filter((s) => s.priceValidationStatus !== "valid");
  if (invalid.length > 0) {
    const first = invalid[0];
    const priceStatus: PriceStatus =
      first.priceValidationStatus === "missing_code"
        ? "check_missing_code"
        : first.priceValidationStatus === "missing_price"
          ? "check_missing_price"
          : "check_invalid_price";

    return {
      priceStatus,
      cheapestSupplierId: null,
      cheapestNetPrice: null,
      estimatedLineCost: null,
      warning: invalid.map((s) => s.failureReason).filter(Boolean).join("; "),
      snapshots,
    };
  }

  const validSnapshots = snapshots.filter(
    (s) => s.priceValidationStatus === "valid" && s.netPrice,
  );

  const sorted = [...validSnapshots].sort((a, b) => {
    const priceDiff = toDecimal(a.netPrice!).cmp(toDecimal(b.netPrice!));
    if (priceDiff !== 0) return priceDiff;
    const aPriority =
      suppliers.find((s) => s.supplierId === a.supplierId)?.priceTiePriority ??
      999;
    const bPriority =
      suppliers.find((s) => s.supplierId === b.supplierId)?.priceTiePriority ??
      999;
    return aPriority - bPriority;
  });

  const cheapest = sorted[0];
  const cheapestNetPrice = toDecimal(cheapest.netPrice!);

  for (const snapshot of snapshots) {
    snapshot.isCheapest = snapshot.supplierId === cheapest.supplierId;
  }

  return {
    priceStatus: "complete",
    cheapestSupplierId: cheapest.supplierId,
    cheapestNetPrice,
    estimatedLineCost: finalOrderQty.times(cheapestNetPrice),
    warning: null,
    snapshots,
  };
}

export function recalculateLineCost(
  finalOrderQty: Decimal,
  cheapestNetPrice: Decimal | null,
): Decimal | null {
  if (!cheapestNetPrice) return null;
  return finalOrderQty.times(cheapestNetPrice);
}

export function toOrderItemSupplierQuotes(
  snapshots: SupplierPriceSnapshot[],
): Array<{
  supplierId: number;
  supplierKey: string;
  supplierName: string;
  supplierProductCode: string | null;
  netPrice: string | null;
  caseSize: string | null;
  isCheapest: boolean;
  priceValidationStatus: string;
  failureReason: string | null;
}> {
  return snapshots.map((snapshot) => ({
    supplierId: snapshot.supplierId,
    supplierKey: snapshot.supplierKey,
    supplierName: snapshot.supplierName,
    supplierProductCode: snapshot.supplierCode,
    netPrice: snapshot.netPrice,
    caseSize: snapshot.caseSize,
    isCheapest: snapshot.isCheapest,
    priceValidationStatus: snapshot.priceValidationStatus,
    failureReason: snapshot.failureReason,
  }));
}
