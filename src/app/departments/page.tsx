import { DepartmentsPageView } from "@/components/departments/departments-page";
import { listDepartmentMappings, listDepartments } from "@/lib/api/departments";

export default async function DepartmentsPage() {
  const [departmentsResult, mappingsResult] = await Promise.all([
    listDepartments(),
    listDepartmentMappings(),
  ]);

  if (!departmentsResult.success) {
    throw new Error(departmentsResult.error);
  }
  if (!mappingsResult.success) {
    throw new Error(mappingsResult.error);
  }

  return (
    <DepartmentsPageView
      departments={departmentsResult.data}
      mappings={mappingsResult.data.mappings}
      importedDepartments={mappingsResult.data.importedDepartments}
    />
  );
}
