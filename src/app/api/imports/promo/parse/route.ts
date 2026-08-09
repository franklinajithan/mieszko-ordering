import { apiError, apiOk, route } from "@/lib/api/http";
import { parseOptionalStoreId } from "@/services/import-parse.service";
import { parsePromoImportFile } from "@/services/promo/promo-import.service";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parsePromoImportFile({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    storeId: parseOptionalStoreId(formData.get("storeId")),
  });
  return apiOk(data);
});
