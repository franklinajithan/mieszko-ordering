import { previewUpload } from "@/app/actions";
import { apiOk, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const preview = await previewUpload(formData);
  return apiOk(preview);
});
