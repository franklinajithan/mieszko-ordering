"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOrderSheetBookStockStatus,
  getOrderSheetSupplierStatus,
} from "@/lib/api";
import type {
  BookStockStatusRow,
  OrderSheetFormState,
  SupplierDataStatusRow,
} from "@/types/orderSheet";

export function useOrderSheetStatus(form: OrderSheetFormState) {
  const [bookStockRows, setBookStockRows] = useState<BookStockStatusRow[]>(
    [],
  );
  const [stockLoading, setStockLoading] = useState(false);
  const [supplierStatus, setSupplierStatus] = useState<SupplierDataStatusRow[]>(
    [],
  );
  const [supplierStatusLoading, setSupplierStatusLoading] = useState(false);


  const reloadBookStock = useCallback(() => {
    if (!form.storeIds.length) {
      setBookStockRows([]);
      setStockLoading(false);
      return;
    }
    setStockLoading(true);
    void getOrderSheetBookStockStatus(form.storeIds)
      .then((response) => {
        setBookStockRows(response.success ? response.data : []);
      })
      .finally(() => setStockLoading(false));
  }, [form.storeIds]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the stock request when the store selection changes.
    reloadBookStock();
  }, [reloadBookStock]);

  useEffect(() => {
    if (!form.supplierIds.length) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear the previous supplier response when selection is empty.
      setSupplierStatus([]);
      return;
    }
    setSupplierStatusLoading(true);
    void getOrderSheetSupplierStatus(form.supplierIds)
      .then((response) => {
        setSupplierStatus(response.success ? response.data : []);
      })
      .finally(() => setSupplierStatusLoading(false));
  }, [form.supplierIds]);

  return {
    bookStockRows,
    setBookStockRows,
    stockLoading,
    supplierStatus,
    supplierStatusLoading,
    reloadBookStock,
  };
}
