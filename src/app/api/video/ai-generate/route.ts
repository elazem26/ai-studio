import { NextRequest, NextResponse } from "next/server";
import {
  startSmartVideoJob,
  pollSmartVideoJob,
  pickSmartestProvider,
  type AspectRatio,
} from "@/lib/ai/smart-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASPECTS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/** GET — engine info, or poll a job: GET /api/video/ai-generate?jobId=... */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = await pollSmartVideoJob(jobId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      jobId: job.jobId,
      status: job.status,
      percent: job.percent,
      stage: job.stage,
      stageLabelAr: job.stageLabelAr,
      stageLabelEn: job.stageLabelEn,
      analysis: job.analysis,
      model: job.model,
      result: job.result,
      retryNote: job.retryNote,
      errorMessage: job.errorMessage,
      elapsedSec: Math.round((Date.now() - job.startedAt) / 1000),
    });
  }

  const smartest = await pickSmartestProvider();
  return NextResponse.json({
    engine: "smart-video-pipeline-v1",
    pipeline: ["read", "analyze", "think", "generate", "deliver"],
    thinker: smartest ?? "zai",
    videoModel: "cogvideox-3",
  });
}

/**
 * POST — start the smart video pipeline (async job):
 *   read → analyze → think (smartest configured LLM) → CogVideoX-3 job
 * Body: { prompt: string, aspectRatio?: "16:9"|"9:16"|"1:1" }
 * Returns: { jobId, analysis } — poll GET ?jobId= every 3-5s.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "prompt مطلوب" }, { status: 400 });
    }
    const aspectRatio = ASPECTS.includes(body?.aspectRatio) ? (body.aspectRatio as AspectRatio) : undefined;

    const job = await startSmartVideoJob({ prompt, aspectRatio });
    return NextResponse.json({ ok: true, jobId: job.jobId, model: job.model });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطأ في بدء توليد الفيديو" },
      { status: 500 }
    );
  }
}
