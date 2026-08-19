"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!form.storeIds.length) {
      setBookStockRows([]);
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
    if (!form.supplierIds.length) {
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
  };
}
