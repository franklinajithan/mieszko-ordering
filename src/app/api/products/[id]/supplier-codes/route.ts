import { productRepository } from "@/repositories";
import {
  isUnavailableSupplierMarker,
  normalizeUtf8SupplierCode,
} from "@/parsers/supplier-codes/supplier-code-file-parser";
import { unavailableSupplierCode } from "@/lib/supplier-code-unavailable";
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

    const rawCode = normalizeUtf8SupplierCode(parsed.data.supplierCode ?? "");
    const markUnavailable =
      parsed.data.unavailable === true ||
      (!!rawCode && isUnavailableSupplierMarker(rawCode));

    if (markUnavailable) {
      const result = await productRepository.upsertSupplierProduct({
        productId,
        supplierId: parsed.data.supplierId,
        supplierCode: unavailableSupplierCode(productId),
        isActive: false,
      });
      return apiOk({ id: result.row.id }, 201);
    }

    if (!rawCode) {
      return apiError(
        "Enter a supplier code, or choose “Not with this supplier”.",
      );
    }

    const result = await productRepository.upsertSupplierProduct({
      productId,
      supplierId: parsed.data.supplierId,
      supplierCode: rawCode,
      isActive: true,
    });
    return apiOk({ id: result.row.id }, 201);
  },
);
