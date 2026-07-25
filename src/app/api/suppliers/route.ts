import { supplierRepository } from "@/repositories";
import { createSupplierSchema } from "@/validators/schemas";
import { apiOk, parseJson, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const parsed = await parseJson(req, createSupplierSchema);
  if (!parsed.ok) return parsed.response;
  const supplier = await supplierRepository.create(parsed.data);
  return apiOk({ id: supplier.id }, 201);
});
