import { departmentMappingRepository, departmentRepository } from "@/repositories";
import {
  departmentMappingSchema,
  idSchema,
} from "@/validators/schemas";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const GET = route(async () => {
  const [mappings, importedDepartments] = await Promise.all([
    departmentMappingRepository.list(),
    departmentMappingRepository.listImportedDepartmentStats(),
  ]);
  return apiOk({ mappings, importedDepartments });
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, departmentMappingSchema);
  if (!parsed.ok) return parsed.response;

  const orderDepartment = await departmentRepository.getById(
    parsed.data.orderDepartmentId,
  );
  if (!orderDepartment || !orderDepartment.isActive) {
    return apiError("Choose an active order department");
  }

  const mapping = await departmentMappingRepository.upsert(
    parsed.data.importedDepartment,
    parsed.data.orderDepartmentId,
  );
  const productsUpdated =
    await departmentMappingRepository.applyMappingToProducts(
      parsed.data.importedDepartment,
      parsed.data.orderDepartmentId,
    );
  revalidatePath("/products");
  revalidatePath("/departments");
  return apiOk({ id: mapping.id, productsUpdated }, 201);
});

const deleteSchema = z.object({ id: idSchema });

export const DELETE = route(async (req) => {
  const parsed = await parseJson(req, deleteSchema);
  if (!parsed.ok) return parsed.response;

  const deleted = await departmentMappingRepository.deleteById(parsed.data.id);
  if (!deleted) return apiError("Mapping not found", 404);
  return apiOk(null);
});
