import type { ImportResult } from "./index";
import type { DepartmentOption } from "./department";

export type ProductBarcode = {
  id: number;
  barcode: string;
};

export type ProductSupplierMapping = {
  supplierProduct: { supplierCode: string };
  supplier: { code: string; name: string };
};

export type Product = {
  id: number;
  name: string;
  department: string;
  orderDepartment: number | null;
  isActive?: boolean;
};

export type ProductRow = {
  product: Product;
  storeProduct: {
    id: number;
    storeProductCode: string;
    retailPrice?: string | null;
  };
  store: {
    id: number;
    name?: string;
  };
};

export type ProductStoreRow = {
  id: number;
  name: string;
  code: string;
  erpType: string;
};

export type ProductCatalogFilters = {
  storeId: number;
  department?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ProductCatalogResult = {
  products: ProductRow[];
  total: number;
  duplicateNameKeys: string[];
};

export type ProductsPageProps = {
  stores: ProductStoreRow[];
  departments: DepartmentOption[];
  products: ProductRow[];
  total: number;
  duplicateNames: Set<string>;
  selectedStore: ProductStoreRow | undefined;
  validStoreId: number | undefined;
  safePage: number;
  pageSize: number;
  pageSizeOptions: number[];
  defaultPageSize: number;
  lineOffset: number;
  paginationParams: Record<string, string | undefined>;
  search?: string;
  activeFilter?: string;
  departmentFilter?: string;
};

export type ProductImportPhase =
  | "idle"
  | "parsing"
  | "importing"
  | "done"
  | "error";

export type ProductImportStatus = {
  phase: ProductImportPhase;
  fileName?: string;
  storeName?: string;
  processed: number;
  total: number;
  estimated?: boolean;
  message?: string;
  result?: ImportResult;
};
