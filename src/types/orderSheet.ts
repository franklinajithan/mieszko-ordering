export type SoldQtyMethod = "max" | "average" | "min";

export type DateRange = {
  startDate: string;
  endDate: string;
};

export type ComparisonPeriod = DateRange & {
  id: string;
};

export type OrderSheetFormState = {
  storeIds: number[];
  orderDate: string;
  deliveryDate: string;
  supplierIds: number[];
  departmentIds: number[];
  comparisonPeriods: ComparisonPeriod[];
  includeBookStock: boolean;
  includeFutureDeliveries: boolean;
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallPeriods: ComparisonPeriod[];
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
  notPostedFileCount?: number;
  notPostedItemCount?: number;
  notPostedQty?: string;
  futureFileCount?: number;
  futureItemCount?: number;
  futureQty?: string;
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

export type OrderItemSupplierQuote = {
  supplierId: number;
  supplierKey: string;
  supplierName: string;
  supplierProductCode: string | null;
  netPrice: string | null;
  caseSize: string | null;
  isCheapest: boolean;
  priceValidationStatus: string;
  failureReason: string | null;
};

export type OrderSheetSupplierColumn = {
  supplierId: number;
  code: string;
  name: string;
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
  supplierQuotes: OrderItemSupplierQuote[];
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

export type OrderSheetComparisonPeriodColumn = {
  periodKey: string;
  title: string;
  dateRangeLabel: string;
  startDate: string;
  endDate: string;
};

export type OrderSheetResult = {
  orderId: number;
  summary: OrderSheetSummary;
  items: OrderSheetItem[];
  bookStockStatus: BookStockStatusRow[];
  periodLabels: string[];
  comparisonPeriods: OrderSheetComparisonPeriodColumn[];
  dailySalesLabels: string[];
  supplierColumns: OrderSheetSupplierColumn[];
};

export type OrderSheetMetadata = {
  storeIds: number[];
  supplierIds?: number[];
  orderDate: string;
  soldQtyMethod: SoldQtyMethod;
  includeBookStock: boolean;
  includeFutureDeliveries: boolean;
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallPeriods: DateRange[];
  comparisonPeriods: DateRange[];
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
  comparisonPeriods: DateRange[];
  includeBookStock: boolean;
  includeFutureDeliveries: boolean;
  includeWastage: boolean;
  includeRtc: boolean;
  shortfallPeriods: DateRange[];
  soldQtyMethod: SoldQtyMethod;
  comment?: string;
  dayBySalesRequired?: boolean;
  dayBySalesStartDate?: string;
  dayBySalesEndDate?: string;
};
