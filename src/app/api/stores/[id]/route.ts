import { storeRepository } from "@/repositories";
import { updateStoreSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const id = await numericParam(params);
    if (id === null) return apiError("Invalid store id");

    const parsed = await parseJson(
      req,
      updateStoreSchema.omit({ id: true }),
    );
    if (!parsed.ok) return parsed.response;

    await storeRepository.update(id, parsed.data);
    return apiOk(null);
  },
);
