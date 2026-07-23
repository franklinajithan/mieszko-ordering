import type { ImportResult } from "@/types";
import type { NormalizedImportRow } from "@/services/product-import.service";

export type ProductImportJob = {
  storeId: number;
  storeName: string;
  fileName: string;
  shareAcrossMspStores: boolean;
  normalizedRows: NormalizedImportRow[];
  result: ImportResult;
  expiresAt: number;
};

const JOB_TTL_MS = 15 * 60 * 1000;

type JobStore = Map<string, ProductImportJob>;

const globalForJobs = globalThis as typeof globalThis & {
  __productImportJobs?: JobStore;
};

function getJobStore(): JobStore {
  if (!globalForJobs.__productImportJobs) {
    globalForJobs.__productImportJobs = new Map();
  }
  return globalForJobs.__productImportJobs;
}

function purgeExpiredJobs() {
  const jobs = getJobStore();
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (job.expiresAt <= now) jobs.delete(jobId);
  }
}

export function saveProductImportJob(job: ProductImportJob): string {
  purgeExpiredJobs();
  const jobs = getJobStore();
  const jobId = crypto.randomUUID();
  jobs.set(jobId, job);
  return jobId;
}

export function getProductImportJob(jobId: string): ProductImportJob | null {
  purgeExpiredJobs();
  const jobs = getJobStore();
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.expiresAt <= Date.now()) {
    jobs.delete(jobId);
    return null;
  }
  return job;
}

export function deleteProductImportJob(jobId: string) {
  getJobStore().delete(jobId);
}
