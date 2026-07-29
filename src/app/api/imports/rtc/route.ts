import {
  deleteRtcUpload,
  importRtc,
  listRtcSummaries,
} from "@/app/actions";
import { apiError, fromActionResult, route } from "@/lib/api/http";
import { idSchema } from "@/validators/schemas";
import { z } from "zod";

export const GET = route(async (req) => {
  const storeId = idSchema.safeParse(
    new URL(req.url).searchParams.get("storeId"),
  );
  if (!storeId.success) return apiError("storeId is required");
  return fromActionResult(await listRtcSummaries(storeId.data));
});

export const DELETE = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const storeId = idSchema.safeParse(params.get("storeId"));
  const rtcDate = z.string().date().safeParse(params.get("rtcDate"));
  if (!storeId.success || !rtcDate.success) {
    return apiError("storeId and rtcDate (yyyy-MM-dd) are required");
  }
  return fromActionResult(
    await deleteRtcUpload(storeId.data, rtcDate.data),
  );
});

export const POST = route(async (req) => {
  const formData = await req.formData();
  return fromActionResult(await importRtc(formData));
});
