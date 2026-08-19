/**
 * Browser API client barrel.
 *
 * Domain clients live in per-area files. They return the shared
 * `{ success, data, error }` envelope and go through `apiRequest` /
 * `apiFormRequest`, which target same-origin `/api` or `NEXT_PUBLIC_API_URL`.
 */
export { API_BASE_URL, apiFormRequest, apiRequest } from "@/lib/api/client";

export * from "@/lib/api/stores";
export * from "@/lib/api/suppliers";
export * from "@/lib/api/departments";
export * from "@/lib/api/products";
export * from "@/lib/api/orders";
export * from "@/lib/api/imports";
export * from "@/lib/api/sales";
export * from "@/lib/api/rtc";
export * from "@/lib/api/wastage";
export * from "@/lib/api/book-stock";
export * from "@/lib/api/promo";
export * from "@/lib/api/supplier-prices";
export * from "@/lib/api/supplier-codes";
export * from "@/lib/api/order-sheet";
