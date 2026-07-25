import { supplierRepository } from "@/repositories";
import { updateSupplierSchema } from "@/validators/schemas";
import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";

export const PATCH = route(
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const id = await numericParam(params);
    if (id === null) return apiError("Invalid supplier id");

    const parsed = await parseJson(
      req,
      updateSupplierSchema.omit({ id: true }),
    );
    if (!parsed.ok) return parsed.response;

    await supplierRepository.update(id, parsed.data);
    return apiOk(null);
  },
);
