import { DepartmentsPageView } from "@/components/departments/departments-page";
import { listDepartments } from "@/lib/api/departments";
import type { Department } from "@/types/department";

export default async function DepartmentsPage() {
  const departments = await listDepartments();
  if (!departments.success) {
    throw new Error(departments.error);
  }
  return <DepartmentsPageView departments={departments.data as Department[]} />;
}
