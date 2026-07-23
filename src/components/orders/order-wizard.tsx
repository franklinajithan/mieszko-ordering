"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  calculateOrderAction,
  createOrder,
  updateOrderPeriods,
  updateOrderSelectedSuppliers,
  uploadOrderStockFile,
} from "@/app/actions";
import { ImportSummary } from "@/components/layout/app-shell";
import { DepartmentFilterDropdown } from "@/components/orders/department-filter-dropdown";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportResult } from "@/types";

type Store = { id: string; name: string };
type Supplier = { id: string; code: string; name: string; isActive: boolean };

const PERIOD_LABELS = [
  { key: "period_1", label: "Period 1", required: true },
  { key: "period_2", label: "Period 2", required: false },
  { key: "period_3", label: "Period 3", required: false },
  { key: "previous_year", label: "Previous year", required: false },
] as const;

export function OrderWizard({
  stores,
  suppliers,
  departments,
}: {
  stores: Store[];
  suppliers: Supplier[];
  departments: string[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<
    Array<{ label: string; result: ImportResult }>
  >([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>(
    suppliers.filter((s) => s.isActive && ["MM", "SP"].includes(s.code)).map((s) => s.id),
  );
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  async function onStep1(formData: FormData) {
    setError(null);
    const result = await createOrder({
      storeId: formData.get("storeId"),
      bookStockDate: formData.get("bookStockDate"),
      clientDeliveryDate: formData.get("clientDeliveryDate"),
      departmentFilters: selectedDepartments,
      notes: formData.get("notes") || undefined,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOrderId(result.data.id);
    setStep(2);
  }

  async function onStep2(formData: FormData) {
    if (!orderId) return;
    setError(null);
    const periods = PERIOD_LABELS.map(({ key }) => ({
      periodKey: key,
      startDate: String(formData.get(`${key}_start`)),
      endDate: String(formData.get(`${key}_end`)),
    }));
    const result = await updateOrderPeriods({ orderId, periods });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setStep(3);
  }

  async function onStep3() {
    if (!orderId) return;
    setError(null);
    if (!selectedSuppliers.length) {
      setError("Select at least one supplier");
      return;
    }
    const result = await updateOrderSelectedSuppliers({
      orderId,
      supplierIds: selectedSuppliers,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setStep(4);
  }

  async function uploadStock(
    uploadType: "book_stock" | "received_not_posted" | "future_delivery",
    formData: FormData,
    label: string,
  ) {
    if (!orderId) return;
    setError(null);
    formData.set("orderId", orderId);
    formData.set("uploadType", uploadType);
    const result = await uploadOrderStockFile(formData);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setUploadResults((prev) => [...prev, { label, result: result.data }]);
  }

  async function onCalculate() {
    if (!orderId) return;
    setError(null);
    const result = await calculateOrderAction({ orderId });
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.push(`/orders/${orderId}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={`rounded-full px-3 py-1 ${step === n ? "bg-zinc-900 text-white" : "bg-zinc-200"}`}
          >
            Step {n}
          </span>
        ))}
      </div>

      {step === 1 ? (
        <form action={onStep1} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-2">
          <div>
            <Label>Store</Label>
            <Select name="storeId" required defaultValue="">
              <option value="" disabled>
                Select store
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Book-stock date</Label>
            <Input name="bookStockDate" type="date" required />
          </div>
          <div>
            <Label>Client delivery date</Label>
            <Input name="clientDeliveryDate" type="date" required />
          </div>
          <DepartmentFilterDropdown
            departments={departments}
            selected={selectedDepartments}
            onChange={setSelectedDepartments}
          />
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea name="notes" />
          </div>
          <Button type="submit">Continue to historical periods</Button>
        </form>
      ) : null}

      {step === 2 ? (
        <form action={onStep2} className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Historical comparison periods</h3>
          <p className="text-sm text-zinc-600">
            Period 1 is required. Period 2, Period 3, and Previous year are optional.
          </p>
          {PERIOD_LABELS.map(({ key, label, required }) => (
            <div key={key} className="grid gap-3 md:grid-cols-3">
              <div className="font-medium">
                {label}
                {!required ? (
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    (optional)
                  </span>
                ) : null}
              </div>
              <div>
                <Label>Start</Label>
                <Input name={`${key}_start`} type="date" required={required} />
              </div>
              <div>
                <Label>End</Label>
                <Input name={`${key}_end`} type="date" required={required} />
              </div>
            </div>
          ))}
          <Button type="submit">Continue to supplier selection</Button>
        </form>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Suppliers for price comparison</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {suppliers
              .filter((s) => s.isActive)
              .map((supplier) => (
                <label key={supplier.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSuppliers.includes(supplier.id)}
                    onChange={(e) => {
                      setSelectedSuppliers((prev) =>
                        e.target.checked
                          ? [...prev, supplier.id]
                          : prev.filter((id) => id !== supplier.id),
                      );
                    }}
                  />
                  {supplier.name} ({supplier.code})
                </label>
              ))}
          </div>
          <Button type="button" onClick={onStep3}>
            Continue to stock uploads
          </Button>
        </div>
      ) : null}

      {step === 4 && orderId ? (
        <div className="space-y-6">
          <StockUploadSection
            title="Book stock"
            uploadType="book_stock"
            suppliers={suppliers}
            onUpload={(fd, label) => uploadStock("book_stock", fd, label)}
          />
          <StockUploadSection
            title="Received but not posted"
            uploadType="received_not_posted"
            suppliers={suppliers}
            onUpload={(fd, label) => uploadStock("received_not_posted", fd, label)}
          />
          <StockUploadSection
            title="Future delivery"
            uploadType="future_delivery"
            suppliers={suppliers}
            requireDeliveryDate
            onUpload={(fd, label) => uploadStock("future_delivery", fd, label)}
          />

          {uploadResults.map(({ label, result }) => (
            <div key={label}>
              <h4 className="mb-2 font-medium">{label}</h4>
              <ImportSummary result={result} />
            </div>
          ))}

          <div className="flex gap-3">
            <Button type="button" onClick={onCalculate}>
              Calculate order
            </Button>
            <Link href={`/orders/${orderId}`}>
              <Button variant="outline" type="button">
                Skip to review
              </Button>
            </Link>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function StockUploadSection({
  title,
  uploadType,
  suppliers,
  requireDeliveryDate,
  onUpload,
}: {
  title: string;
  uploadType: string;
  suppliers: Supplier[];
  requireDeliveryDate?: boolean;
  onUpload: (formData: FormData, label: string) => Promise<void>;
}) {
  const [mappingType, setMappingType] = useState<
    "store_product_code" | "barcode" | "supplier_code"
  >("store_product_code");

  async function handleSubmit(formData: FormData) {
    formData.set("mappingType", mappingType);
    await onUpload(formData, title);
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      <input type="hidden" name="uploadType" value={uploadType} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>File</Label>
          <Input name="file" type="file" accept=".csv,.xlsx,.xls" required />
        </div>
        <div>
          <Label>Mapping type</Label>
          <Select
            value={mappingType}
            onChange={(e) =>
              setMappingType(
                e.target.value as "store_product_code" | "barcode" | "supplier_code",
              )
            }
          >
            <option value="store_product_code">Store product code</option>
            <option value="barcode">Barcode</option>
            <option value="supplier_code">Supplier code</option>
          </Select>
        </div>
        <div>
          <Label>Reference column</Label>
          <Input name="referenceColumn" placeholder="Column header" required />
        </div>
        <div>
          <Label>Quantity column</Label>
          <Input name="quantityColumn" placeholder="Column header" required />
        </div>
        {mappingType === "supplier_code" ? (
          <div>
            <Label>Supplier</Label>
            <Select name="supplierId" required defaultValue="">
              <option value="" disabled>
                Select supplier
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {requireDeliveryDate ? (
          <div>
            <Label>Delivery date</Label>
            <Input name="deliveryDate" type="date" required />
          </div>
        ) : null}
      </div>
      <Button type="submit">Upload {title.toLowerCase()}</Button>
    </form>
  );
}
