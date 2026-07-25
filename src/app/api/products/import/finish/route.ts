import { z } from "zod";
import { finishProductImport } from "@/app/actions";
import { fromActionResult, parseJson, route } from "@/lib/api/http";

const bodySchema = z.object({
  jobId: z.string().min(1),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  return fromActionResult(await finishProductImport(parsed.data.jobId));
});
