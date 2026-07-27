import { z } from "zod";
import { departmentRepository, productRepository } from "@/repositories";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  orderDepartment: z.coerce.number().int().positive().nullable(),
});

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const parsed = await parseJson(req, bodySchema);
    if (!parsed.ok) return parsed.response;

    const orderDepartmentId = parsed.data.orderDepartment;
    if (orderDepartmentId != null) {
      const known = await departmentRepository.getById(orderDepartmentId);
      if (!known || !known.isActive) {
        return apiError(
          "Choose an active department from the departments list",
        );
      }
    }

    const updated = await productRepository.assignOrderDepartment(
      productId,
      orderDepartmentId,
    );
    if (!updated) return apiError("Product not found", 404);
    return apiOk(null);
  },
);
