import type { ActionResult, FilePreview } from "@/types";
import { apiFormRequest } from "./client";

/** Generic spreadsheet parse (headers + sample rows). Throws on failure. */
export async function parseImportFile(formData: FormData): Promise<FilePreview> {
  const result = await apiFormRequest<FilePreview>("/imports/parse", formData);
  if (!result.success) throw new Error(result.error);
  return result.data;
}
