import { apiError, apiOk, route } from "@/lib/api/http";
import { parseBookStockImportFile } from "@/services/book-stock-import.service";

export const POST = route(async (req) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("No file uploaded");

  const data = await parseBookStockImportFile({
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
  });
  return apiOk(data);
});
