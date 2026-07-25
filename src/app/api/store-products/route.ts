import { productRepository } from "@/repositories";
import { storeProductSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, storeProductSchema);
  if (!parsed.ok) return parsed.response;
  const row = await productRepository.addStoreProduct(parsed.data);
  return apiOk({ id: row.id }, 201);
});
