import { productRepository } from "@/repositories";
import { barcodeSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const GET = route(
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const barcodes = await productRepository.getBarcodes(productId);
    return apiOk(barcodes);
  },
);

export const POST = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const parsed = await parseJson(
      req,
      barcodeSchema.omit({ productId: true }),
    );
    if (!parsed.ok) return parsed.response;

    const row = await productRepository.addBarcode({
      productId,
      barcode: parsed.data.barcode,
    });
    return apiOk({ id: row.id }, 201);
  },
);
