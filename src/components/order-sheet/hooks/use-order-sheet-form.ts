"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    createInitialOrderSheetForm,
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers],
  );
  const dayBySalesDates = useMemo(() => getDayBySalesDates(form), [form]);
  const shortfallDays = totalUniquePeriodDays(form.shortfallPeriods);

  const didInitStores = useRef(false);
  const didInitSuppliers = useRef(false);
  const didInitDepartments = useRef(false);

  useEffect(() => {
    if (didInitStores.current || !stores.length) return;
    didInitStores.current = true;
    setForm((current) => {
      if (current.storeIds.length) return current;
      return {
        ...current,
        storeIds: stores.map((store) => store.id),
      };
    });
  }, [stores]);

  useEffect(() => {
    if (didInitSuppliers.current || !activeSuppliers.length) return;
    didInitSuppliers.current = true;
    const defaults = activeSuppliers
      .filter((supplier) =>
        DEFAULT_ORDER_SHEET_SUPPLIER_CODES.includes(supplier.code),
      )
      .map((supplier) => supplier.id);
    if (!defaults.length) return;
    setForm((current) => {
      if (current.supplierIds.length) return current;
      return { ...current, supplierIds: defaults };
    });
  }, [activeSuppliers]);

  useEffect(() => {
    if (didInitDepartments.current || !departments.length) return;
    didInitDepartments.current = true;
    setForm((current) => {
      if (current.departmentIds.length) return current;
      return {
        ...current,
        departmentIds: departments.map((department) => department.id),
      };
    });
  }, [departments]);

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
    didInitStores.current = false;
    didInitSuppliers.current = false;
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
