import type { FilePreview } from "@/types";
import { apiFormRequest } from "./client";

/** Previews throw on failure to match the legacy server-action behaviour. */
export async function previewUpload(formData: FormData): Promise<FilePreview> {
  const result = await apiFormRequest<FilePreview>(
    "/uploads/preview",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

type DailySalesPreview = FilePreview & {
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export async function previewDailySalesUpload(
  formData: FormData,
): Promise<DailySalesPreview> {
  const result = await apiFormRequest<DailySalesPreview>(
    "/uploads/preview-daily-sales",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}
