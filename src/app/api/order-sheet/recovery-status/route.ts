import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiError, apiOk, route } from "@/lib/api/http";
import { queueState } from "@/services/download-queue.service";

const schema = z.array(z.number().int().positive().safe()).min(1).max(250);

export const GET = route(async request => {
  const values = new URL(request.url).searchParams.get("ids")?.split(",").map(Number) ?? [];
  const parsed = schema.safeParse(values);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    return apiError("Provide between 1 and 250 unique recovery job IDs.");
  }
  const rows = await db.execute(sql`SELECT r.id::int AS id, r.source_type AS feed,
    r.source_start_date::text AS report_date, s.name AS store_name,
    ${queueState} AS status, (r.source_type IN ('wastage','rtc') AND r.status='success' AND r.details->>'zero_activity'='true') AS zero_activity, r.downloaded_row_count, r.imported_row_count,
    r.error_message
    FROM data_import_runs r
    LEFT JOIN stores s ON s.id=r.store_id
    WHERE r.id IN (${sql.join(parsed.data.map(id => sql`${id}`), sql`,`)})
    ORDER BY r.source_start_date ASC, r.id ASC`);
  return apiOk({ jobs: rows, checkedAt: new Date().toISOString() });
});
