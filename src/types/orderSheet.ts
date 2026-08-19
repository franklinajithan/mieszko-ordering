export type SoldQtyMethod = "max" | "average" | "min";

export type ComparisonPeriod = {
  id: string;
  startDate: string;
  endDate: string;
};

export type OrderSheetFormState = {
  storeIds: number[];
  orderDate: string;
  deliveryDate: string;
  supplierIds: number[];
  departmentIds: number[];
  comparisonPeriods: ComparisonPeriod[];
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallStartDate: string;
  shortfallEndDate: string;
  soldQtyMethod: SoldQtyMethod;
  comment: string;
  dayBySalesRequired: boolean;
  dayBySalesStartDate: string;
  dayBySalesEndDate: string;
};

export type SupplierDataStatusRow = {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  lastUpdated: string | null;
  status: "current" | "stale" | "missing";
};

export type BookStockStatusRow = {
  storeId: number;
  storeCode: string;
  storeName: string;
  available: boolean;
  bookStockDate: string | null;
  importedAt: string | null;
  itemCount: number;
  totalBookStockQty: string | null;
  message: string;
};

export type BookStockStatus = BookStockStatusRow;

export type SalesDataStatusRow = {
  salesDate: string;
  storeId: number;
  storeCode: string;
  storeName: string;
  itemCount: number;
  totalSoldQty: string;
  lastUpdated: string | null;
  available: boolean;
};

export type OrderSheetItem = {
  orderItemId: number;
  storeProductId: number;
  storeCode: string | null;
  storeName: string | null;
  itemCode: string;
  barcode: string | null;
  productName: string;
  supplierCode: string | null;
  supplierName: string | null;
  departmentName: string | null;
  currentStock: string;
  periodSales: string[];
  dailySales: string[];
  calculatedSoldQty: string;
  wastageQty: string;
  rtcQty: string;
  shortfallDays: number;
  suggestedOrderQty: string;
  orderQty: string;
  selected: boolean;
};

export type OrderSheetSummary = {
  productCount: number;
  productsToOrder: number;
  totalSuggestedQty: string;
  selectedSupplierCount: number;
  shortfallDays: number;
};

export type OrderSheetResult = {
  orderId: number;
  summary: OrderSheetSummary;
  items: OrderSheetItem[];
  bookStockStatus: BookStockStatusRow[];
  periodLabels: string[];
  dailySalesLabels: string[];
};

export type OrderSheetMetadata = {
  storeIds: number[];
  orderDate: string;
  soldQtyMethod: SoldQtyMethod;
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallStartDate: string;
  shortfallEndDate: string;
  comparisonPeriods: Array<{ startDate: string; endDate: string }>;
  dayBySalesRequired?: boolean;
  dayBySalesStartDate?: string;
  dayBySalesEndDate?: string;
};

export type OrderSheetGenerateInput = {
  orderId?: number;
  storeIds: number[];
  orderDate: string;
  deliveryDate: string;
  bookStockDate?: string;
  supplierIds: number[];
  departmentIds: number[];
  comparisonPeriods: Array<{ startDate: string; endDate: string }>;
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallStartDate: string;
  shortfallEndDate: string;
  soldQtyMethod: SoldQtyMethod;
  comment?: string;
  dayBySalesRequired?: boolean;
  dayBySalesStartDate?: string;
  dayBySalesEndDate?: string;
};
