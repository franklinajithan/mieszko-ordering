import { departmentRepository } from "@/repositories";
import { createDepartmentSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createDepartmentSchema);
  if (!parsed.ok) return parsed.response;

  const code = parsed.data.code?.trim();
  const department = await departmentRepository.create({
    name: parsed.data.name.trim(),
    code: code || null,
    isActive: parsed.data.isActive,
  });
  return apiOk({ id: department.id }, 201);
});
