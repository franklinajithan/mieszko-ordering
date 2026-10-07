"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { OrderSheetPanel, OrderSheetSection } from "@/components/order-sheet/order-sheet-section";
import type { DepartmentOption } from "@/types/department";
import type { Supplier } from "@/types/supplier";
import type { Store } from "@/types/store";
import type {
  ComparisonPeriod,
  OrderSheetFormState,
  SoldQtyMethod,
} from "@/types/orderSheet";

type Props = {
  stores: Store[];
  suppliers: Supplier[];
  departments: DepartmentOption[];
  form: OrderSheetFormState;
  errors: Record<string, string>;
  shortfallDays: number;
  onChange: Dispatch<SetStateAction<OrderSheetFormState>>;
  onUpdatePeriod: (id: string, patch: Partial<ComparisonPeriod>) => void;
  onAddPeriod: () => void;
  onRemovePeriod: (id: string) => void;
  onUpdateShortfallPeriod: (id: string, patch: Partial<ComparisonPeriod>) => void;
  onAddShortfallPeriod: () => void;
  onRemoveShortfallPeriod: (id: string) => void;
};

export function OrderSheetFormPanel({
  stores,
  suppliers,
  departments,
  form,
  errors,
  shortfallDays,
  onChange,
  onUpdatePeriod,
  onAddPeriod,
  onRemovePeriod,
  onUpdateShortfallPeriod,
  onAddShortfallPeriod,
  onRemoveShortfallPeriod,
}: Props) {
  const set = (patch: Partial<OrderSheetFormState>) =>
    onChange((current) => ({ ...current, ...patch }));

  return (
    <OrderSheetPanel className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <OrderSheetSection number={1} title="Order Information" compact>
          <div className="space-y-4">
            <SearchableMultiSelect
              label="Stores"
              placeholder="Select stores"
              required
              allowSelectAll
              options={stores.map((store) => ({
                id: store.id,
                label: store.code,
                hint: store.name,
              }))}
              selected={form.storeIds}
              onChange={(storeIds) => set({ storeIds })}
              error={errors.storeIds ?? null}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateInput
                label="Order Date *"
                name="orderDate"
                value={form.orderDate}
                onChange={(orderDate) => set({ orderDate })}
              />
              <DateInput
                label="Delivery Date *"
                name="deliveryDate"
                value={form.deliveryDate}
                error={errors.deliveryDate}
                onChange={(deliveryDate) => set({ deliveryDate })}
              />
            </div>
          </div>
        </OrderSheetSection>

        <OrderSheetSection number={2} title="Suppliers & Departments" compact>
          <div className="grid gap-4">
            <SearchableMultiSelect
              label="Suppliers"
              placeholder="Select suppliers"
              required
              allowSelectAll
              options={suppliers.map((supplier) => ({
                id: supplier.id,
                label: supplier.code,
                hint: supplier.name,
              }))}
              selected={form.supplierIds}
              onChange={(supplierIds) => set({ supplierIds })}
              error={errors.supplierIds ?? null}
            />
            <SearchableMultiSelect
              label="Departments"
              placeholder="Select departments"
              required
              allowSelectAll
              options={departments.map((department) => ({
                id: department.id,
                label: department.name,
              }))}
              selected={form.departmentIds}
              onChange={(departmentIds) => set({ departmentIds })}
              error={errors.departmentIds ?? null}
            />
          </div>
        </OrderSheetSection>
      </div>

      <div className="border-t border-zinc-100" />

      <OrderSheetSection number={3} title="Options & Shortfall" compact>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Toggle
              label="Include Wastage"
              checked={form.includeWastage}
              onChange={(includeWastage) => set({ includeWastage })}
            />
            <Toggle
              label="Include RTC"
              checked={form.includeRtc}
              onChange={(includeRtc) => set({ includeRtc })}
            />
            <Toggle
              label="Day-by-sales required"
              checked={form.dayBySalesRequired}
              onChange={(dayBySalesRequired) => set({ dayBySalesRequired })}
            />
          </div>
          {form.dayBySalesRequired ? (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-4">
              <Label>Day-by-sales period</Label>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <DateInput
                  label="Start date"
                  name="dayBySalesStartDate"
                  value={form.dayBySalesStartDate}
                  error={errors.dayBySalesStartDate}
                  compact
                  onChange={(dayBySalesStartDate) => set({ dayBySalesStartDate })}
                />
                <DateInput
                  label="End date"
                  name="dayBySalesEndDate"
                  value={form.dayBySalesEndDate}
                  error={errors.dayBySalesEndDate}
                  compact
                  onChange={(dayBySalesEndDate) => set({ dayBySalesEndDate })}
                />
              </div>
            </div>
          ) : null}
          <div>
            <Label>Sold qty calculation</Label>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {(["max", "average", "min"] as SoldQtyMethod[]).map((method) => (
                <label key={method} className="flex items-center gap-2 capitalize">
                  <input
                    type="radio"
                    name="soldQtyMethod"
                    checked={form.soldQtyMethod === method}
                    onChange={() => set({ soldQtyMethod: method })}
                  />
                  {method}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Shortfall periods</Label>
            <div className="mt-2 space-y-3">
              {form.shortfallPeriods.map((period, index) => (
                <div
                  key={period.id}
                  className="grid gap-4 rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
                >
                  <p className="pb-2 text-sm font-medium text-zinc-800 sm:pb-0">
                    Period {index + 1}
                  </p>
                  <DateInput
                    label="Start Date"
                    name={`shortfall-${period.id}-start`}
                    value={period.startDate}
                    onChange={(startDate) =>
                      onUpdateShortfallPeriod(period.id, { startDate })
                    }
                  />
                  <DateInput
                    label="End Date"
                    name={`shortfall-${period.id}-end`}
                    value={period.endDate}
                    error={errors[`shortfall-${index}`]}
                    onChange={(endDate) =>
                      onUpdateShortfallPeriod(period.id, { endDate })
                    }
                  />
                  <div className="flex justify-end sm:justify-start">
                    {form.shortfallPeriods.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onRemoveShortfallPeriod(period.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {errors.shortfallPeriods ? (
              <p className="mt-2 text-xs text-red-600">{errors.shortfallPeriods}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={onAddShortfallPeriod}
            >
              + Add Period
            </Button>
            <p className="mt-2 text-sm font-medium text-blue-700">
              {shortfallDays} days
            </p>
          </div>
        </div>
      </OrderSheetSection>

      <div className="border-t border-zinc-100" />

      <OrderSheetSection number={6} title="Comparison Periods" compact>
        <div className="space-y-3">
          {form.comparisonPeriods.map((period, index) => (
            <div
              key={period.id}
              className="grid gap-4 rounded-lg border border-zinc-100 bg-zinc-50/50 p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
            >
              <p className="pb-2 text-sm font-medium text-zinc-800 sm:pb-0">
                Period {index + 1}
              </p>
              <DateInput
                label="Start Date"
                name={`period-${period.id}-start`}
                value={period.startDate}
                onChange={(startDate) => onUpdatePeriod(period.id, { startDate })}
              />
              <DateInput
                label="End Date"
                name={`period-${period.id}-end`}
                value={period.endDate}
                error={errors[`period-${index}`]}
                onChange={(endDate) => onUpdatePeriod(period.id, { endDate })}
              />
              <div className="flex justify-end sm:justify-start">
                {form.comparisonPeriods.length > 1 ? (
                  <Button type="button" variant="outline" onClick={() => onRemovePeriod(period.id)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {errors.comparisonPeriods ? (
          <p className="mt-2 text-xs text-red-600">{errors.comparisonPeriods}</p>
        ) : null}
        <Button type="button" variant="outline" className="mt-4" onClick={onAddPeriod}>
          + Add Period
        </Button>
      </OrderSheetSection>

      <div className="border-t border-zinc-100" />

      <OrderSheetSection number={7} title="Comment" compact>
        <Textarea
          value={form.comment}
          maxLength={500}
          onChange={(event) => set({ comment: event.target.value })}
          placeholder="Enter any notes or comments..."
          rows={3}
        />
        <p className="mt-1 text-xs text-zinc-500">{form.comment.length}/500</p>
      </OrderSheetSection>
    </OrderSheetPanel>
  );
}

function DateInput({
  label,
  name,
  value,
  error,
  compact = false,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className={compact ? "text-xs text-zinc-500" : undefined}>{label}</Label>
      <DateField
        name={name}
        className="mt-1.5"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
