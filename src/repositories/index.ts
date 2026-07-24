import { isDatabaseEnabled } from "@/lib/runtime-config";
import * as mock from "@/repositories/mock";

type MockRepos = typeof mock;
type RepoName = keyof Pick<
  MockRepos,
  | "storeRepository"
  | "supplierRepository"
  | "departmentRepository"
  | "productRepository"
  | "dailySalesRepository"
  | "supplierPriceRepository"
  | "bookStockRepository"
  | "rtcRepository"
  | "wastageRepository"
  | "orderRepository"
>;

let postgresModule: typeof import("@/repositories/postgres") | null = null;

async function getPostgresModule() {
  if (!postgresModule) {
    postgresModule = await import("@/repositories/postgres");
  }
  return postgresModule;
}

function createRepositoryProxy<K extends RepoName>(name: K): MockRepos[K] {
  return new Proxy({} as MockRepos[K], {
    get(_target, prop) {
      return async (...args: unknown[]) => {
        if (isDatabaseEnabled()) {
          const postgres = await getPostgresModule();
          const repo = postgres[name] as Record<string, (...a: unknown[]) => unknown>;
          const method = repo[prop as string];
          if (typeof method !== "function") return method;
          return method(...args);
        }
        const repo = mock[name] as Record<string, (...a: unknown[]) => unknown>;
        const method = repo[prop as string];
        if (typeof method !== "function") return method;
        return method(...args);
      };
    },
  });
}

export const storeRepository = createRepositoryProxy("storeRepository");
export const supplierRepository = createRepositoryProxy("supplierRepository");
export const departmentRepository = createRepositoryProxy("departmentRepository");
export const productRepository = createRepositoryProxy("productRepository");
export const dailySalesRepository = createRepositoryProxy("dailySalesRepository");
export const supplierPriceRepository = createRepositoryProxy("supplierPriceRepository");
export const bookStockRepository = createRepositoryProxy("bookStockRepository");
export const rtcRepository = createRepositoryProxy("rtcRepository");
export const wastageRepository = createRepositoryProxy("wastageRepository");
export const orderRepository = createRepositoryProxy("orderRepository");

export { MOCK_DEMO_ORDER_ID } from "@/repositories/mock";
