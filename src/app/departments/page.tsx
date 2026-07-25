import { DepartmentsPageView } from "@/components/departments/departments-page";
import { departmentRepository } from "@/repositories";

export default async function DepartmentsPage() {
  const departments = await departmentRepository.list();
  return <DepartmentsPageView departments={departments} />;
}
