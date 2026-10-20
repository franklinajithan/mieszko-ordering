"use client";

import { useState } from "react";
import { SupplierOrderPanel } from "@/components/orders/supplier-order-panel";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import { OrderSheetRecovery } from "@/components/order-sheet/order-sheet-recovery";
import { OrderSheetActionBar } from "@/components/order-sheet/order-sheet-action-bar";
import { OrderSheetFormPanel } from "@/components/order-sheet/order-sheet-form-panel";
import { OrderSheetResultsPanel } from "@/components/order-sheet/order-sheet-results-panel";
import { OrderSheetStatusPanels } from "@/components/order-sheet/order-sheet-status-panels";
import { useOrderSheetForm } from "@/components/order-sheet/hooks/use-order-sheet-form";
import { useOrderSheetStatus } from "@/components/order-sheet/hooks/use-order-sheet-status";
import { useOrderSheetWorkflow } from "@/components/order-sheet/hooks/use-order-sheet-workflow";
import type { DepartmentOption } from "@/types/department";
import type { Supplier } from "@/types/supplier";
import type { Store } from "@/types/store";
import { AppShell } from "@/components/layout/app-shell";

export function OrderSheetPage({
  stores,
  suppliers,
  departments,
}: {
  stores: Store[];
  suppliers: Supplier[];
  departments: DepartmentOption[];
}) {
  const [recoveryScanRequest,setRecoveryScanRequest]=useState(0);
  const formState = useOrderSheetForm(stores, suppliers, departments);
  const status = useOrderSheetStatus(formState.form);
  const workflow = useOrderSheetWorkflow({
    form: formState.form,
    dayBySalesDates: formState.dayBySalesDates,
    bookStockRows: status.bookStockRows,
    setForm: formState.setForm,
    setBookStockRows: status.setBookStockRows,
  });

  return (
    <AppShell title="Order Sheet">
      <div className="space-y-5 pb-40">
        <OrderSheetFormPanel
          stores={stores}
          suppliers={formState.activeSuppliers}
          departments={departments}
          form={formState.form}
          errors={workflow.fieldErrors}
          shortfallDays={formState.shortfallDays}
          onChange={formState.setForm}
          onUpdatePeriod={formState.updatePeriod}
          onAddPeriod={formState.addPeriod}
          onRemovePeriod={formState.removePeriod}
          onUpdateShortfallPeriod={formState.updateShortfallPeriod}
          onAddShortfallPeriod={formState.addShortfallPeriod}
          onRemoveShortfallPeriod={formState.removeShortfallPeriod}
        />

        <OrderSheetStatusPanels
          bookStockRows={status.bookStockRows}
          stockLoading={status.stockLoading}
          supplierStatus={status.supplierStatus}
          supplierStatusLoading={status.supplierStatusLoading}
          onNotPostedChanged={status.reloadBookStock}
          suppliers={suppliers}
        />

        {workflow.result ? (
          <OrderSheetResultsPanel
            result={workflow.result}
            items={workflow.items}
            includeWastage={formState.form.includeWastage}
            includeRtc={formState.form.includeRtc}
            showStoreColumn={formState.form.storeIds.length > 1}
            onToggleSelected={workflow.toggleSelected}
            onToggleAll={workflow.toggleAll}
            onOrderQtyChange={workflow.changeOrderQty}
          />
        ) : null}

        {workflow.orderId ? <SupplierOrderPanel key={workflow.orderId} orderId={workflow.orderId} beforeGenerate={workflow.persistDraft} revision={JSON.stringify(workflow.items.map(item=>[item.orderItemId,item.orderQty,item.selected]))} /> : null}

        {workflow.dataWarnings.length > 0 ? (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Source data warnings</p>
            <ul className="mt-2 list-disc pl-5">{workflow.dataWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </div>
        ) : null}

        <OrderSheetRecovery form={formState.form} scanRequest={recoveryScanRequest} onRecoveryFinished={()=>void workflow.refreshSourceWarnings()} />

        {workflow.error ? (
          <p className="text-sm text-red-600">{workflow.error}</p>
        ) : null}

        <OrderSheetActionBar
          orderId={workflow.orderId}
          generating={workflow.generating}
          generateProgress={workflow.generateProgress}
          saving={workflow.saving}
          onClear={() => workflow.setConfirmClear(true)}
          onSave={() => void workflow.onSaveDraft()}
          onExport={() => void workflow.onExport()}
          onExportDairy={() => void workflow.onExport("dairy")}
          onGenerate={() => {setRecoveryScanRequest(value=>value+1);void workflow.onGenerate();}}
        />

        <ConfirmAlertDialog
          open={workflow.confirmClear}
          onOpenChange={workflow.setConfirmClear}
          title="Clear order sheet?"
          description="This will reset the form and remove generated results."
          confirmLabel="Clear All"
          onConfirm={workflow.onClearAll}
        />
      </div>
    </AppShell>
  );
}
