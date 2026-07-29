import type { ImportResult, SalesMappingType } from "@/types";
import type { PreparedRtcRow } from "@/services/rtc-import.service";

export type RtcImportJob = {
  storeId: number;
  storeName: string;
  fileName: string;
  rtcDate: string;
  mappingType: SalesMappingType;
  importId: number;
  rows: PreparedRtcRow[];
  result: ImportResult;
  expiresAt: number;
};

type JobStore = Map<string, RtcImportJob>;

const globalForJobs = globalThis as typeof globalThis & {
  __rtcImportJobs?: JobStore;
};

function getJobStore(): JobStore {
  if (!globalForJobs.__rtcImportJobs) {
    globalForJobs.__rtcImportJobs = new Map();
  }
  return globalForJobs.__rtcImportJobs;
}

function purgeExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of getJobStore()) {
    if (job.expiresAt <= now) getJobStore().delete(jobId);
  }
}

export function saveRtcImportJob(job: RtcImportJob) {
  purgeExpiredJobs();
  const jobId = crypto.randomUUID();
  getJobStore().set(jobId, job);
  return jobId;
}

export function getRtcImportJob(jobId: string) {
  purgeExpiredJobs();
  return getJobStore().get(jobId) ?? null;
}

export function deleteRtcImportJob(jobId: string) {
  getJobStore().delete(jobId);
}
