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
