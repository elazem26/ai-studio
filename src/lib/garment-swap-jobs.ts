/**
 * In-memory job store for long-running garment-swap operations.
 *
 * WHY: the swap pipeline takes 40-90s in ONE HTTP request. The preview
 * proxy (preview-*.space-z.ai) kills such long-held connections before
 * the response reaches the browser, so the UI shows "فشل تبديل الملابس"
 * even though the server finished and saved the result.
 *
 * FIX: POST starts a background job and returns a jobId instantly; the UI
 * polls GET?jobId=... every few seconds with short-lived requests that
 * survive any proxy timeout.
 */

export type SwapJobStatus = "running" | "done" | "error";

export type SwapJob = {
  id: string;
  status: SwapJobStatus;
  stage: string;
  stageLabelAr: string;
  stageLabelEn: string;
  percent: number;
  result?: Record<string, unknown>;
  /** Multi-result support (numResults setting) — all generated variations. */
  results?: Array<Record<string, unknown>>;
  error?: string;
  message?: string;
  createdAt: number;
  updatedAt: number;
};

/* globalThis survives Next.js dev HMR module reloads */
const g = globalThis as unknown as { __garmentSwapJobs?: Map<string, SwapJob> };
const jobs = (g.__garmentSwapJobs ??= new Map<string, SwapJob>());

const JOB_TTL_MS = 30 * 60 * 1000; // keep finished jobs 30 min

function sweep(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createSwapJob(id: string): SwapJob {
  sweep();
  const job: SwapJob = {
    id,
    status: "running",
    stage: "queued",
    stageLabelAr: "في قائمة الانتظار…",
    stageLabelEn: "Queued…",
    percent: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getSwapJob(id: string): SwapJob | undefined {
  return jobs.get(id);
}

export function updateSwapStage(id: string, stage: string, labelAr: string, labelEn: string, percent: number): void {
  const j = jobs.get(id);
  if (!j || j.status !== "running") return;
  j.stage = stage;
  j.stageLabelAr = labelAr;
  j.stageLabelEn = labelEn;
  j.percent = Math.max(j.percent, Math.min(97, Math.round(percent)));
  j.updatedAt = Date.now();
}

export function finishSwapJob(
  id: string,
  result: Record<string, unknown>,
  results?: Array<Record<string, unknown>>
): void {
  const j = jobs.get(id);
  if (!j) return;
  j.status = "done";
  j.percent = 100;
  j.stage = "done";
  j.stageLabelAr = "اكتمل التبديل";
  j.stageLabelEn = "Swap complete";
  j.result = result;
  if (results && results.length > 0) j.results = results;
  j.updatedAt = Date.now();
}

export function failSwapJob(id: string, error: string, message?: string): void {
  const j = jobs.get(id);
  if (!j) return;
  j.status = "error";
  j.error = error;
  j.message = message;
  j.updatedAt = Date.now();
}
