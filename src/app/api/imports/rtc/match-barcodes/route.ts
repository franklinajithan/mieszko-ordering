import { z } from "zod";
import { productRepository, storeRepository } from "@/repositories";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";

const schema = z.object({
  storeId: z.number().int().positive(),
  barcodes: z.array(z.string()).min(1).max(10000),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, schema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const matches = await productRepository.findStoreProductMatchesForFileBarcodes(
    parsed.data.storeId,
    parsed.data.barcodes,
  );

  return apiOk(
    matches.map((m) => ({
      fileBarcode: m.fileBarcode,
      storeProductCode: m.storeProductCode,
      productName: m.productName,
    })),
  );
});
