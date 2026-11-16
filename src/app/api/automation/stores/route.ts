import { apiError, apiOk, route } from "@/lib/api/http";
import { listCrmStores } from "@/services/crm-automation.service";

export const GET = route(async () => {
  try { return apiOk(await listCrmStores()); }
  catch (error) {
    let current: unknown = error;
    for (let i = 0; i < 6 && current && typeof current === 'object'; i++) {
      const cause = current as { code?: string; cause?: unknown };
      if (cause.code === '42P01') return apiError('CRM setup requires migrations/manual/2026-10-16-crm-store-settings.sql. Ask the database administrator to apply it after backup.', 503);
      current = cause.cause;
    }
    throw error;
  }
});
