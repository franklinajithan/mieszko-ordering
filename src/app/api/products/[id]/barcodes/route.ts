import { productRepository } from "@/repositories";
import { barcodeSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const GET = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const productId = await numericParam(params);
    if (productId === null) return apiError("Invalid product id");

    const storeIdParam = new URL(req.url).searchParams.get("storeId");
    const storeId = storeIdParam ? Number(storeIdParam) : undefined;
    if (storeIdParam && (!Number.isInteger(storeId) || storeId! <= 0)) {
      return apiError("Invalid storeId");
    }

    const barcodes = await productRepository.getBarcodesForProduct(
      productId,
      storeId,
    );
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

    const storeProduct = await productRepository.findStoreProductForProduct(
      productId,
      parsed.data.storeId,
    );
    if (!storeProduct) {
      return apiError("Store product not found for this product and store", 404);
    }

    const row = await productRepository.addBarcodeIfAbsent({
      storeId: parsed.data.storeId,
      storeProductId: storeProduct.id,
      barcode: parsed.data.barcode,
    });
    if (!row) {
      return apiError("Barcode already exists for this store", 409);
    }
    return apiOk({ id: row.id }, 201);
  },
);
