import { departmentRepository } from "@/repositories";
import { updateDepartmentSchema } from "@/validators/schemas";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const parsed = await parseJson(
      req,
      updateDepartmentSchema.omit({ id: true }),
    );
    if (!parsed.ok) return parsed.response;

    const data = parsed.data;
    const payload = {
      ...data,
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.code !== undefined ? { code: data.code.trim() || null } : {}),
    };

    const updated = await departmentRepository.update(id, payload);
    if (!updated) return apiError("Department not found", 404);
    return apiOk(null);
  },
);
