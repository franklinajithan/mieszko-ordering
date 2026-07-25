import { departmentRepository, productRepository } from "@/repositories";
import { createProductSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createProductSchema);
  if (!parsed.ok) return parsed.response;

  const department = parsed.data.department.trim();
  const orderDepartment = parsed.data.orderDepartment?.trim() || department;
  await departmentRepository.ensureByName(orderDepartment);

  const product = await productRepository.createProduct({
    name: parsed.data.name,
    department,
    orderDepartment,
    isActive: parsed.data.isActive,
  });
  return apiOk({ id: product.id }, 201);
});
