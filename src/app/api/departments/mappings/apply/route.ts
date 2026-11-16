import { departmentMappingRepository } from "@/repositories";
import { apiOk, route } from "@/lib/api/http";
import { revalidatePath } from "next/cache";

export const POST = route(async () => {
  const result = await departmentMappingRepository.applyToProducts();
  revalidatePath("/products");
  revalidatePath("/departments");
  return apiOk(result);
});
