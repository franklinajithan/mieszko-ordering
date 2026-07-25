import { supplierRepository } from "@/repositories";
import { createSupplierSchema } from "@/validators/schemas";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createSupplierSchema);
  if (!parsed.ok) return parsed.response;

  const code = parsed.data.code.trim();
  const existing = await supplierRepository.getByCode(code);
  if (existing) {
    return apiError(`Supplier code "${code}" already exists`, 409);
  }

  const supplier = await supplierRepository.create({
    ...parsed.data,
    code,
    name: parsed.data.name.trim(),
  });
  return apiOk({ id: supplier.id }, 201);
});
