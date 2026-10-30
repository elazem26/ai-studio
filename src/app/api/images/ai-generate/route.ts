import { NextRequest, NextResponse } from "next/server";
import {
  startSmartImageJob,
  pollSmartImageJob,
  pickSmartestProvider,
  type AspectRatio,
} from "@/lib/ai/smart-generation";
import { POLLINATIONS_MODELS } from "@/lib/ai/pollinations";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASPECTS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/** GET — engine info, or poll a job: GET /api/images/ai-generate?jobId=... */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = await pollSmartImageJob(jobId);
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
      result: job.result,
      errorMessage: job.errorMessage,
      elapsedSec: Math.round((Date.now() - job.startedAt) / 1000),
    });
  }

  const smartest = await pickSmartestProvider();
  return NextResponse.json({
    engine: "smart-pipeline-v1",
    pipeline: ["read", "analyze", "think", "generate", "review"],
    thinker: smartest ?? "zai",
    imageModels: POLLINATIONS_MODELS,
  });
}

/**
 * POST — start the smart image pipeline (async job):
 *   read → analyze → think (smartest configured LLM) → generate (CogView/Flux)
 *   → review (VLM score, one smart retry if < 70).
 * Body: { prompt: string, aspectRatio?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4", seed?: number }
 * Returns: { ok, jobId } immediately — poll GET ?jobId= every ~2.5s.
 * (Async because a synchronous 20-70s POST gets cut by preview proxies
 *  and the client receives HTML → "Unexpected token '<'… is not valid JSON".)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "prompt مطلوب" }, { status: 400 });
    }
    const aspectRatio = ASPECTS.includes(body?.aspectRatio) ? (body.aspectRatio as AspectRatio) : undefined;
    const seed = Number.isFinite(body?.seed) ? Number(body.seed) : undefined;

    const job = startSmartImageJob({ prompt, aspectRatio, seed });
    return NextResponse.json({ ok: true, jobId: job.jobId });
  } catch (e) {
    await logEvent({
      category: "system", level: "error",
      message: "Smart image gen route crashed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ في إنشاء الصورة" }, { status: 500 });
  }
}
