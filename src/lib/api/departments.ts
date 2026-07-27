import type { ActionResult } from "@/types";
import { apiRequest } from "@/lib/api/client";
import { Department } from "@/types/department";

export function createDepartment(
  input: { name: string; code: string | null; isActive: boolean },
): Promise<ActionResult<{ id: string }>> {
  return apiRequest("/departments", { method: "POST", body: input });
}

export function updateDepartmentDetails(
  input: { id: string } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/departments/${id}`, { method: "PATCH", body });
}

export function toggleDepartmentActive(
  id: string,
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