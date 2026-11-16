import { apiError, apiOk, route } from "@/lib/api/http";
import { parseOptionalStoreId } from "@/services/import-parse.service";
import { parseBookStockImportFile } from "@/services/book-stock/book-stock-import.service";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parseBookStockImportFile({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    storeId: parseOptionalStoreId(formData.get("storeId")),
  });
  return apiOk(data);
});
