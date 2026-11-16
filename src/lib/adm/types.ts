export type AdmCatalogItem = {
  name: string;
  code: string | null;
  barcode: string | null;
  salesUnit: string | null;
  previousQty: number | null;
  previousOrders?: Record<string, number | null>;
};
