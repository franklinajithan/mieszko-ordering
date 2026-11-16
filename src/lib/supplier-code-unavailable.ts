import { isUnavailableSupplierMarker } from "@/parsers/supplier-codes/supplier-code-file-parser";

/** Sentinel stored on supplier_products when HO/user confirms no supplier. */
export const UNAVAILABLE_SUPPLIER_CODE_PREFIX = "__NONE__:";

export function unavailableSupplierCode(productId: number): string {
  return `${UNAVAILABLE_SUPPLIER_CODE_PREFIX}${productId}`;
}

export function isUnavailableSupplierCodeStored(code: string): boolean {
  return code.startsWith(UNAVAILABLE_SUPPLIER_CODE_PREFIX);
}

export function formatSupplierCodeDisplay(
  supplierCode: string,
  supplierLabel: string,
): string {
  if (
    isUnavailableSupplierCodeStored(supplierCode) ||
    isUnavailableSupplierMarker(supplierCode)
  ) {
    return `Not with ${supplierLabel}`;
  }
  return supplierCode;
}
