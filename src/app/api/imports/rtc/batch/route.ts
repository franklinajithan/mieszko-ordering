import { runRtcImportBatch } from "@/app/actions";
import { fromActionResult, route } from "@/lib/api/http";

export const POST = route(async (req) => {
  const body = await req.json();
  return fromActionResult(await runRtcImportBatch(body));
});
