import { productRepository } from "@/repositories";
import { supplierProductSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const supplierProducts =
      await productRepository.getSupplierProducts(productId);
    return apiOk(supplierProducts);
  },
);

export const POST = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const parsed = await parseJson(
      req,
      supplierProductSchema.omit({ productId: true }),
    );
    if (!parsed.ok) return parsed.response;

    const row = await productRepository.addSupplierProduct({
      productId,
      supplierId: parsed.data.supplierId,
      supplierCode: parsed.data.supplierCode,
      isActive: parsed.data.isActive,
    });
    return apiOk({ id: row.id }, 201);
  },
);
