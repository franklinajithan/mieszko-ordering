import { AppShell } from "@/components/layout/app-shell";
import { DepartmentForm } from "@/components/departments/department-form";
import DepartmentList from "@/components/departments/department-list";
import type { Department } from "@/types/department";
export function DepartmentsPageView({
  departments,
}: {
  departments: Department[];
}) {
  return (
    <AppShell
      title="Departments"
      description="Manage product departments used for catalog grouping and order filtering."
    >
      <div className="space-y-8">
        <DepartmentForm />
        <DepartmentList departments={departments} />
      </div>    
    </AppShell>
  );
}
