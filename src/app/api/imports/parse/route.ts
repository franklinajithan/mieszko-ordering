import { apiError, apiOk, route } from "@/lib/api/http";
import {
  parseImportSpreadsheet,
  parseOptionalStoreId,
} from "@/services/import-parse.service";

/** Generic spreadsheet parse for imports that only need headers + sample rows. */
export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parseImportSpreadsheet({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    storeId: parseOptionalStoreId(formData.get("storeId")),
  });
  return apiOk(data);
});
