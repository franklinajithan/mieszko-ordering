/**
 * Domain + shared import primitives only.
 * Feature UI state (preview/progress/list rows) lives next to components.
 * Runtime column/chunk config: `@/lib/import-config`.
 */

export type { Store, StoreOption } from "./store";
export type { Supplier } from "./supplier";
export type {
  Department,
  DepartmentOption,
  DepartmentMapping,
  ImportedDepartmentStat,
} from "./department";
export type {
  Product,
  ProductBarcode,
  ProductCatalogFilters,
  ProductCatalogResult,
  ProductRow,
  ProductStoreRow,
  ProductSupplierMapping,
} from "./product";
export type {
  ActionResult,
  ErpType,
  FilePreview,
  ImportError,
  ImportResult,
  MappingType,
  ParsedRow,
  PeriodKey,
  PriceStatus,
  PriceValidationStatus,
  SalesMappingType,
  StockEventType,
  UploadType,
} from "./import";
