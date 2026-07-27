import { departmentRepository, productRepository } from "@/repositories";
import { createProductSchema } from "@/validators/schemas";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createProductSchema);
  if (!parsed.ok) return parsed.response;

  const department = parsed.data.department.trim();
  let orderDepartmentId = parsed.data.orderDepartment ?? null;
  if (orderDepartmentId == null) {
    orderDepartmentId = await departmentRepository.ensureIdByName(department);
  } else {
    const known = await departmentRepository.getById(orderDepartmentId);
    if (!known || !known.isActive) {
      return apiError("Choose an active department from the departments list");
    }
  }

  const product = await productRepository.createProduct({
    name: parsed.data.name,
    department,
    orderDepartment: orderDepartmentId,
    isActive: parsed.data.isActive,
  });
  return apiOk({ id: product.id }, 201);
});

export const GET = route(async () => {
  const products = await productRepository.list();
  return apiOk(products);
});
