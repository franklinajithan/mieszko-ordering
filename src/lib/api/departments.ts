import type { ActionResult, ImportResult } from "@/types";
import { apiFormRequest, apiRequest } from "./client";

export function createDepartment(
  input: unknown,
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

export function importDepartments(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/departments/import", formData);
}
