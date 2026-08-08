/**
 * Browser API client barrel.
 *
 * Domain clients live in per-area files. They return the shared
 * `{ success, data, error }` envelope and go through `apiRequest` /
 * `apiFormRequest`, which target same-origin `/api` or `NEXT_PUBLIC_API_URL`.
 */
export { API_BASE_URL, apiFormRequest, apiRequest } from "./client";

export * from "./stores";
export * from "./suppliers";
export * from "./departments";
export * from "./products";
export * from "./orders";
export * from "./imports";
export * from "./sales";
export * from "./rtc";
export * from "./wastage";
export * from "./book-stock";
export * from "./promo";
export * from "./supplier-prices";
