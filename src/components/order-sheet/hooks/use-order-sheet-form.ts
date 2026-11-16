"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DepartmentOption } from "@/types/department";
import type { Supplier } from "@/types/supplier";
import type { Store } from "@/types/store";
import type { ComparisonPeriod, OrderSheetFormState } from "@/types/orderSheet";
import {
  createComparisonPeriod,
  createInitialOrderSheetForm,
  createShortfallPeriod,
  DEFAULT_ORDER_SHEET_SUPPLIER_CODES,
  getDayBySalesDates,
} from "@/utils/order-sheet-form";
import { totalUniquePeriodDays } from "@/utils/orderSheetCalculations";

export function useOrderSheetForm(
  stores: Store[],
  suppliers: Supplier[],
  departments: DepartmentOption[],
) {
  const [form, setForm] = useState<OrderSheetFormState>(
    () => ({ ...createInitialOrderSheetForm(),
      storeIds: stores.map(store => store.id),
      supplierIds: suppliers.filter(supplier => supplier.isActive && DEFAULT_ORDER_SHEET_SUPPLIER_CODES.includes(supplier.code)).map(supplier => supplier.id),
      departmentIds: departments.map(department => department.id),
    }),
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );
  const dayBySalesDates = useMemo(() => getDayBySalesDates(form), [form]);
  const shortfallDays = totalUniquePeriodDays(form.shortfallPeriods);

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

  function updateShortfallPeriod(id: string, patch: Partial<ComparisonPeriod>) {
    setForm((current) => ({
      ...current,
      shortfallPeriods: current.shortfallPeriods.map((period) =>
        period.id === id ? { ...period, ...patch } : period,
      ),
    }));
  }

  function addShortfallPeriod() {
    setForm((current) => ({
      ...current,
      shortfallPeriods: [
        ...current.shortfallPeriods,
        createShortfallPeriod(current.shortfallPeriods),
      ],
    }));
  }

  function removeShortfallPeriod(id: string) {
    setForm((current) => ({
      ...current,
      shortfallPeriods: current.shortfallPeriods.filter((period) => period.id !== id),
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
    updateShortfallPeriod,
    addShortfallPeriod,
    removeShortfallPeriod,
  };
}
