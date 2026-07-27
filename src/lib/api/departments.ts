import type { ActionResult } from "@/types";
import { apiRequest } from "@/lib/api/client";
import type {
  Department,
  DepartmentMapping,
  ImportedDepartmentStat,
} from "@/types/department";

export function createDepartment(
  input: { name: string; code: string | null; isActive: boolean },
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/departments", { method: "POST", body: input });
}

export function updateDepartmentDetails(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/departments/${id}`, { method: "PATCH", body });
}

export function toggleDepartmentActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/departments/${id}`, {
    method: "PATCH",
    body: { isActive },
  });
}



export function listDepartments(): Promise<ActionResult<Department[]>> {
  return apiRequest("/departments", { method: "GET" });
}

export function listDepartmentMappings(): Promise<
  ActionResult<{
    mappings: DepartmentMapping[];
    importedDepartments: ImportedDepartmentStat[];
  }>
> {
  return apiRequest("/departments/mappings");
}

export function upsertDepartmentMapping(input: {
  importedDepartment: string;
  orderDepartmentId: number;
}): Promise<ActionResult<{ id: number; productsUpdated: number }>> {
  return apiRequest("/departments/mappings", {
    method: "POST",
    body: input,
  });
}

export function deleteDepartmentMapping(
  id: number,
): Promise<ActionResult> {
  return apiRequest("/departments/mappings", {
    method: "DELETE",
    body: { id },
  });
}

export function applyDepartmentMappings(): Promise<
  ActionResult<{ updated: number; mappings: number }>
> {
  return apiRequest("/departments/mappings/apply", { method: "POST" });
}
