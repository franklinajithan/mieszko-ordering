import { importProducts } from "@/app/actions";
import { fromActionResult, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const formData = await req.formData();
  return fromActionResult(await importProducts(formData));
});
