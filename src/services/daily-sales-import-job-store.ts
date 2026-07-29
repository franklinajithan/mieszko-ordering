import type { ImportResult, SalesMappingType } from "@/types";
import type { AggregatedDailySale } from "@/services/daily-sales-import.service";

export type DailySalesImportJob = {
  storeId: number;
  storeName: string;
  fileName: string;
  mappingType: SalesMappingType;
  sales: AggregatedDailySale[];
  result: ImportResult;
  expiresAt: number;
};

type JobStore = Map<string, DailySalesImportJob>;

const globalForJobs = globalThis as typeof globalThis & {
  __dailySalesImportJobs?: JobStore;
};

function getJobStore(): JobStore {
  if (!globalForJobs.__dailySalesImportJobs) {
    globalForJobs.__dailySalesImportJobs = new Map();
  }
  return globalForJobs.__dailySalesImportJobs;
}

function purgeExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of getJobStore()) {
    if (job.expiresAt <= now) getJobStore().delete(jobId);
  }
}

export function saveDailySalesImportJob(job: DailySalesImportJob) {
  purgeExpiredJobs();
  const jobId = crypto.randomUUID();
  getJobStore().set(jobId, job);
  return jobId;
}

export function getDailySalesImportJob(jobId: string) {
  purgeExpiredJobs();
  return getJobStore().get(jobId) ?? null;
}

export function deleteDailySalesImportJob(jobId: string) {
  getJobStore().delete(jobId);
}
