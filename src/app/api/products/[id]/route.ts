import { departmentRepository, productRepository } from "@/repositories";
import { updateProductSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const id = await numericParam(params);
    if (id === null) return apiError("Invalid product id");

    const product = await productRepository.getById(id);
    if (!product) return apiError("Product not found", 404);

    return apiOk(product);
  },
);

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
      if (data.orderDepartment == null) {
        data.orderDepartment = null;
      } else {
        const known = await departmentRepository.getById(data.orderDepartment);
        if (!known || !known.isActive) {
          return apiError(
            "Choose an active department from the departments list",
          );
        }
      }
    }

    await productRepository.updateProduct(id, data);
    return apiOk(null);
  },
);
