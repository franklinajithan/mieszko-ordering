import { z } from "zod";
import { runDailySalesImportBatch } from "@/app/actions";
import { fromActionResult, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  jobId: z.string().min(1),
  batchIndex: z.number().int().min(0),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  return fromActionResult(await runDailySalesImportBatch(parsed.data));
});
