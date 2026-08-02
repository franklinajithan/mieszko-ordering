import { apiError, apiOk, route } from "@/lib/api/http";
import { parseOptionalStoreId } from "@/services/import-parse.service";
import { parseWastageImportFile } from "@/services/wastage-import.service";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parseWastageImportFile({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    storeId: parseOptionalStoreId(formData.get("storeId")),
  });
  return apiOk(data);
});
