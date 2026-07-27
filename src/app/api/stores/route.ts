import { storeRepository } from "@/repositories";
import { createStoreSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const GET = route(async () => {
  const stores = await storeRepository.list();
  return apiOk(stores);
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createStoreSchema);
  if (!parsed.ok) return parsed.response;
  const store = await storeRepository.create(parsed.data);
  return apiOk({ id: store.id }, 201);
});
