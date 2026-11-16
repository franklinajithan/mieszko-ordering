import type { DepartmentOption } from "@/types/department";

export function departmentName(
  departments: DepartmentOption[],
  orderDepartmentId: number | null | undefined,
): string | null {
  if (orderDepartmentId == null) return null;
  return (
    departments.find((department) => department.id === orderDepartmentId)
      ?.name ?? null
  );
}
