/**
 * Browser API client barrel.
 *
 * Implementations live in per-domain files (`stores.ts`, `suppliers.ts`, …).
 * They mirror the legacy server-action signatures and return the same
 * `{ success, data, error }` envelope, so call sites only need to import from
 * `@/lib/api`.
 *
 * Every call goes through `apiRequest` / `apiFormRequest` (see `client.ts`),
 * which target the same-origin `/api` routes by default or `NEXT_PUBLIC_API_URL`
 * when set (e.g. a future FastAPI backend).
 */
export { API_BASE_URL, apiFormRequest, apiRequest } from "./client";

export * from "./stores";
export * from "./suppliers";
export * from "./departments";
export * from "./products";
export * from "./uploads";
export * from "./imports";
export * from "./orders";
