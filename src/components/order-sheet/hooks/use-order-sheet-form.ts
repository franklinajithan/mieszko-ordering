"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Supplier } from "@/types/supplier";
import type { Store } from "@/types/store";
import type { ComparisonPeriod, OrderSheetFormState } from "@/types/orderSheet";
import {
  createComparisonPeriod,
  createInitialOrderSheetForm,
  DEFAULT_ORDER_SHEET_SUPPLIER_CODES,
  getDayBySalesDates,
} from "@/utils/order-sheet-form";
import { diffDaysInclusive } from "@/utils/orderSheetCalculations";

export function useOrderSheetForm(stores: Store[], suppliers: Supplier[]) {
  const [form, setForm] = useState<OrderSheetFormState>(
    createInitialOrderSheetForm,
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );
  const dayBySalesDates = useMemo(() => getDayBySalesDates(form), [form]);
  const shortfallDays = diffDaysInclusive(
    form.shortfallStartDate,
    form.shortfallEndDate,
  );

  useEffect(() => {
    if (form.storeIds.length || !stores.length) return;
    setForm((current) => ({
      ...current,
      storeIds: stores.map((store) => store.id),
    }));
  }, [stores, form.storeIds.length]);

  useEffect(() => {
    if (form.supplierIds.length) return;
    const defaults = activeSuppliers
      .filter((supplier) =>
        DEFAULT_ORDER_SHEET_SUPPLIER_CODES.includes(supplier.code),
      )
      .map((supplier) => supplier.id);
    if (defaults.length) {
      setForm((current) => ({ ...current, supplierIds: defaults }));
    }
  }, [activeSuppliers, form.supplierIds.length]);

  function updatePeriod(id: string, patch: Partial<ComparisonPeriod>) {
    setForm((current) => ({
      ...current,
      comparisonPeriods: current.comparisonPeriods.map((period) =>
        period.id === id ? { ...period, ...patch } : period,
      ),
    }));
  }

  function addPeriod() {
    setForm((current) => ({
      ...current,
      comparisonPeriods: [
        ...current.comparisonPeriods,
        createComparisonPeriod(current.comparisonPeriods),
      ],
    }));
  }

  function removePeriod(id: string) {
    setForm((current) => ({
      ...current,
      comparisonPeriods: current.comparisonPeriods.filter(
        (period) => period.id !== id,
      ),
    }));
  }

  function resetForm() {
    setForm(createInitialOrderSheetForm());
  }

  return {
    form,
    setForm: setForm as Dispatch<SetStateAction<OrderSheetFormState>>,
    resetForm,
    activeSuppliers,
    dayBySalesDates,
    shortfallDays,
    updatePeriod,
    addPeriod,
    removePeriod,
  };
}
