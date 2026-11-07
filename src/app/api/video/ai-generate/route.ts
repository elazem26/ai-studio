import { NextRequest, NextResponse } from "next/server";
import {
  startSmartVideoJob,
  pollSmartVideoJob,
  pickSmartestProvider,
  type AspectRatio,
} from "@/lib/ai/smart-generation";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ASPECTS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/** أنماط العرض (طريقة العرض) — تُدمج في الوصف قبل التحليل */
const STYLES: Record<string, string> = {
  cinematic: "cinematic film look, dramatic lighting, anamorphic lens, film grain, shallow depth of field",
  realistic: "ultra realistic documentary style, natural lighting, true-to-life colors, steady camera",
  anime: "anime style animation, vivid colors, clean line art, expressive motion",
  cartoon: "3D cartoon style, soft shading, playful lively motion",
  ad: "polished commercial advertisement look, glossy lighting, dynamic camera moves",
};

const QUALITIES = ["speed", "quality"] as const;
const FORMATS = ["mp4", "webm", "gif"] as const;
const DURATIONS: number[] = [5, 10];
const FPSS: number[] = [30, 60];
const SIZES = ["1280x720", "1920x1080", "720x1280", "1024x1024"];

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
    const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!rawPrompt) {
      return NextResponse.json({ error: "prompt مطلوب" }, { status: 400 });
    }
    const aspectRatio = ASPECTS.includes(body?.aspectRatio) ? (body.aspectRatio as AspectRatio) : undefined;

    // نمط العرض (سينمائي / واقعي / ...) يُدمج في الوصف قبل التحليل
    const styleAdd = STYLES[body?.style] ?? "";
    const prompt = styleAdd ? `${rawPrompt}. Style: ${styleAdd}` : rawPrompt;

    // صورة الإطار الأول (صورة→فيديو لحفظ الملامح) — مسار محلي صالح فقط
    let imagePath: string | undefined;
    if (typeof body?.imagePath === "string" && body.imagePath.trim()) {
      try {
        imagePath = await resolveFilePath(body.imagePath.trim());
      } catch {
        return NextResponse.json({ error: "صورة الإطار الأول غير موجودة" }, { status: 404 });
      }
    }

    const quality = QUALITIES.includes(body?.quality) ? body.quality : undefined;
    const format = FORMATS.includes(body?.format) ? body.format : undefined;
    const duration = DURATIONS.includes(Number(body?.duration)) ? Number(body.duration) : undefined;
    const fps = FPSS.includes(Number(body?.fps)) ? Number(body.fps) : undefined;
    const size = SIZES.includes(body?.size) ? body.size : undefined;
    const withAudio = typeof body?.withAudio === "boolean" ? body.withAudio : undefined;
    const music = !!body?.music;
    const speechText = typeof body?.speech?.text === "string" ? body.speech.text.trim() : "";
    const speech = speechText
      ? { text: speechText.slice(0, 900), voice: typeof body.speech?.voice === "string" ? body.speech.voice : undefined }
      : undefined;

    const job = await startSmartVideoJob({
      prompt,
      aspectRatio,
      quality,
      size,
      fps,
      duration,
      withAudio,
      imagePath,
      speech,
      music,
      format,
    });
    return NextResponse.json({ ok: true, jobId: job.jobId, model: job.model });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطأ في بدء توليد الفيديو" },
      { status: 500 }
    );
  }
}
