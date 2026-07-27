import { AppShell } from "@/components/layout/app-shell";
import { DepartmentsTabs } from "@/components/departments/departments-tabs";
import type {
  Department,
  DepartmentMapping,
  ImportedDepartmentStat,
} from "@/types/department";

export function DepartmentsPageView({
  departments,
  mappings,
  importedDepartments,
}: {
  departments: Department[];
  mappings: DepartmentMapping[];
  importedDepartments: ImportedDepartmentStat[];
}) {
  return (
    <AppShell
      title="Departments"
      description="Manage order departments and map imported ERP labels to them."
    >
      <DepartmentsTabs
        departments={departments}
        mappings={mappings}
        importedDepartments={importedDepartments}
      />
    </AppShell>
  );
}
