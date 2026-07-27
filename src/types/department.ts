export type Department = {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
};

export type DepartmentOption = Pick<Department, "id" | "name">;

export type DepartmentMapping = {
  id: number;
  importedDepartment: string;
  orderDepartmentId: number;
  orderDepartmentName: string;
};

export type ImportedDepartmentStat = {
  importedDepartment: string;
  productCount: number;
  orderDepartmentId: number | null;
  orderDepartmentName: string | null;
};

export function departmentName(
  departments: DepartmentOption[],
  orderDepartmentId: number | null | undefined,
): string | null {
  if (orderDepartmentId == null) return null;
  return departments.find((department) => department.id === orderDepartmentId)?.name ?? null;
}

