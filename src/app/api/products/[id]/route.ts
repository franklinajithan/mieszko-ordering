import { departmentRepository, productRepository } from "@/repositories";
import { updateProductSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const id = await numericParam(params);
    if (id === null) return apiError("Invalid product id");

    const parsed = await parseJson(
      req,
      updateProductSchema.omit({ id: true }),
    );
    if (!parsed.ok) return parsed.response;

    const data = { ...parsed.data };
    if (data.department !== undefined) {
      data.department = data.department.trim();
    }
    if (data.orderDepartment !== undefined) {
      const orderDepartment = data.orderDepartment?.trim() || null;
      if (orderDepartment) {
        await departmentRepository.ensureByName(orderDepartment);
      }
      data.orderDepartment = orderDepartment;
    }

    await productRepository.updateProduct(id, data);
    return apiOk(null);
  },
);
