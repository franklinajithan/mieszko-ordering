import { apiError, apiOk, route } from "@/lib/api/http";
import { parseDailySalesImportFile } from "@/services/daily-sales-import.service";
import { parseOptionalStoreId } from "@/services/import-parse.service";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parseDailySalesImportFile({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    storeId: parseOptionalStoreId(formData.get("storeId")),
  });
  return apiOk(data);
});
