/**
 * Smart Generation Engine v1 — "يقرأ ← يحلل ← يفكر ← يولّد ← يدقّق"
 *
 * Built 2026-10-30 per owner request: the Image-Tools generator produced the
 * same flat look every time because the raw user text went straight to the
 * image model with zero interpretation. This engine adds a real creative
 * pipeline around BOTH the image and the video generators:
 *
 *   1. READING   — normalize the request (any language, incl. Arabic slang)
 *   2. ANALYSIS  — the smartest configured LLM breaks the request down
 *                  (subject, setting, composition, lighting, mood, style…)
 *   3. THINKING  — the same LLM writes a rich professional English prompt
 *                  + negative prompt + picks style & aspect ratio
 *   4. GENERATION— image: Pollinations/Flux with the enriched prompt
 *                  video: z-ai CogVideoX-3 via zai.video.generations.create
 *   5. REVIEW    — a VLM scores the result against the understood intent;
 *                  a low score triggers ONE smarter retry with the critique
 *                  baked into the prompt.
 *
 * The "smartest model" question is answered by callLLM() (free-llm.ts):
 * it walks the user-configured providers (Groq / Gemini / OpenRouter /
 * Cerebras / Mistral / Cohere / Cloudflare / NVIDIA / GitHub) and always
 * falls back to the built-in z-ai GLM — with a smartness-based ordering
 * defined here so reasoning-heavy providers go first.
 */

import { callLLM, getConfiguredProviders, type LLMProvider } from "@/lib/ai/free-llm";
import { generateImageBase64 } from "@/lib/ai/pollinations";
import { logEvent } from "@/lib/logger";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCb);
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

// ============================================================
// Types
// ============================================================

export type GenerationKind = "image" | "video";
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface SmartAnalysis {
  /** What the model understood from the request (Arabic, for the UI) */
  understanding: string;
  /** The analysis breakdown (Arabic, short) — subject/setting/light/… */
  analysis: string;
  /** The reasoning summary that led to the creative decisions (Arabic) */
  reasoning: string;
  /** Rich professional English prompt fed to the image/video model */
  enhancedPrompt: string;
  /** What to avoid */
  negativePrompt: string;
  /** Detected/chosen visual style */
  style: string;
  /** Chosen aspect ratio */
  aspectRatio: AspectRatio;
  /** Which provider did the thinking (transparency for the UI) */
  provider: string;
}

export interface SmartImageResult {
  ok: boolean;
  path: string;
  url: string;
  width: number;
  height: number;
  analysis: SmartAnalysis;
  attempts: number;
  critique: { score: number; note: string } | null;
  provider: string;
  imageModel: string;
  errorMessage?: string;
}

// ============================================================
// Provider ordering — smartest first (for the THINK step)
// ============================================================

/** Rough reasoning-capability ranking of the free providers. */
const SMARTNESS_ORDER: LLMProvider[] = [
  "google",     // Gemini 2.x — strong multimodal reasoning
  "openrouter", // user-selectable model (can be very strong)
  "groq",       // fast Llama 3.x 70b class
  "mistral",
  "cerebras",
  "cohere",
  "cloudflare",
  "github",     // retired, last resort among externals
  "zai",        // built-in GLM — final safety net (callLLM appends anyway)
];

/**
 * Pick the smartest CONFIGURED provider as the preferred thinker.
 * Falls back to undefined → callLLM uses its own order + z-ai safety net.
 */
export async function pickSmartestProvider(): Promise<LLMProvider | undefined> {
  try {
    const configured = await getConfiguredProviders();
    const ranked = SMARTNESS_ORDER.filter((p) => configured.includes(p));
    return ranked[0];
  } catch {
    return undefined;
  }
}

// ============================================================
// STEP 1-3: READ → ANALYZE → THINK
// ============================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a world-class creative director and prompt engineer for AI image and video generation.

You receive a user request (often in Arabic, sometimes casual or vague). You must:

1. UNDERSTAND it (read between the lines — resolve ambiguity into the most likely professional interpretation).
2. ANALYZE the required visual: subject, action, environment, composition, camera, lighting, color palette, mood, style.
3. THINK and make creative decisions that make the result look professional (lighting scheme, lens, depth, composition rules like rule-of-thirds, quality tags).
4. OUTPUT one enhanced English prompt ready for a diffusion model (image) or a video model (camera motion + scene dynamics for video).

STRICT output — a single JSON object, no markdown fences, no commentary:
{
  "understanding": "جملة-جملتان بالعربية: ماذا فهمت من الطلب",
  "analysis": "سطران بالعربية: تفكيك الطلب (العنصر/المكان/الإضاءة/المزاج...)",
  "reasoning": "سطر بالعربية: لماذا اخترت هذه القرارات الإبداعية",
  "enhancedPrompt": "one rich professional English prompt (60-110 words) — concrete nouns, camera + lighting + composition + style tags, no abstract filler",
  "negativePrompt": "short English negative prompt (worst quality, artifacts, extra limbs, watermark ... as relevant)",
  "style": "photorealistic | cinematic | anime | 3d-render | digital-art | watercolor | product-shot",
  "aspectRatio": "1:1 | 16:9 | 9:16 | 4:3 | 3:4"
}

Rules for enhancedPrompt:
- For video: describe the SCENE + CAMERA MOVEMENT (slow dolly-in, orbit, handheld...) + motion of subjects + pacing. Single continuous shot.
- Never mention "AI", "prompt", or the word "enhanced".
- Keep the user's core intent EXACTLY; enrich around it, never replace it.`;

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const ASPECTS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/**
 * READ + ANALYZE + THINK — turns any user request into a professional
 * generation plan. Never throws: on any failure it returns a honest
 * minimal plan built from the raw prompt so generation can proceed.
 */
export async function analyzeRequest(
  userPrompt: string,
  kind: GenerationKind,
  aspectHint?: AspectRatio
): Promise<SmartAnalysis> {
  const fallback: SmartAnalysis = {
    understanding: userPrompt.slice(0, 200),
    analysis: kind === "video" ? "طلب فيديو — تحويل مباشر بدون تفكير إضافي." : "طلب صورة — تحويل مباشر بدون تفكير إضافي.",
    reasoning: "تعذّر تشغيل خطوة التفكير، تم استخدام الطلب كما هو.",
    enhancedPrompt: userPrompt,
    negativePrompt: "worst quality, low quality, blurry, watermark, text artifacts",
    style: "photorealistic",
    aspectRatio: aspectHint ?? "1:1",
    provider: "none",
  };

  const prefer = await pickSmartestProvider();
  try {
    const res = await callLLM(
      [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `KIND: ${kind === "video" ? "VIDEO (short single-shot clip)" : "IMAGE"}\n` +
            (aspectHint ? `USER ASPECT PREFERENCE: ${aspectHint} (respect it)\n` : "") +
            `REQUEST:\n${userPrompt.trim()}`,
        },
      ],
      { preferProvider: prefer, temperature: 0.6, maxTokens: 900 }
    );

    const json = extractJson(res.text);
    if (!json) return { ...fallback, provider: res.provider };

    const enhancedPrompt = String(json.enhancedPrompt || "").trim() || fallback.enhancedPrompt;
    const rawAspect = String(json.aspectRatio || "") as AspectRatio;
    return {
      understanding: String(json.understanding || fallback.understanding).slice(0, 400),
      analysis: String(json.analysis || fallback.analysis).slice(0, 500),
      reasoning: String(json.reasoning || fallback.reasoning).slice(0, 400),
      enhancedPrompt: kind === "video" ? `${enhancedPrompt} (single continuous shot, smooth natural motion)` : enhancedPrompt,
      negativePrompt: String(json.negativePrompt || fallback.negativePrompt).slice(0, 300),
      style: String(json.style || fallback.style).slice(0, 40),
      aspectRatio: ASPECTS.includes(rawAspect) ? rawAspect : (aspectHint ?? "1:1"),
      provider: res.provider,
    };
  } catch (e) {
    console.warn("[smart-generation] analysis failed:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

// ============================================================
// STEP 5: REVIEW (VLM critique of a generated IMAGE)
// ============================================================

async function critiqueImage(
  dataUrl: string,
  understanding: string,
  enhancedPrompt: string
): Promise<{ score: number; note: string; fix: string }> {
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await (ZAIModule.default).create();
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Rate this generated image against the creative intent.

INTENT: ${understanding.slice(0, 300)}
PROMPT USED: ${enhancedPrompt.slice(0, 300)}

Score 0-100 on: prompt fidelity, professional quality (lighting/composition/detail), absence of artifacts.
Output JSON only: {"score": 0-100, "note": "one short sentence", "fix": "if score<70: one concrete English instruction to fix the biggest problem, else empty string"}`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    } as never);
    const text = response.choices?.[0]?.message?.content ?? "";
    const json = extractJson(text);
    if (json) {
      return {
        score: Math.max(0, Math.min(100, Number(json.score) || 0)),
        note: String(json.note || "").slice(0, 200),
        fix: String(json.fix || "").slice(0, 200),
      };
    }
  } catch (e) {
    console.warn("[smart-generation] critique failed:", e instanceof Error ? e.message : e);
  }
  return { score: 75, note: "تعذر التدقيق الآلي — قبول النتيجة.", fix: "" };
}

// ============================================================
// FULL VIDEO PIPELINE (async job style — generation takes minutes)
// ============================================================

export interface SmartVideoJob {
  jobId: string;
  status: "thinking" | "generating" | "downloading" | "done" | "error";
  percent: number;
  /** Server-side stage key for the UI (progress.* label keys) */
  stage: string;
  stageLabelAr: string;
  stageLabelEn: string;
  analysis: SmartAnalysis | null;
  model: string;
  taskId: string | null;
  backend?: string;
  result: { url: string; remoteUrl: string; coverUrl: string; sizeMB: number; format?: string; hasSpeech?: boolean; hasMusic?: boolean } | null;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
  /** Gateway-poll throttle: last time we actually queried the backend */
  lastGatewayQueryAt?: number;
  /** Retry countdown info for the UI (when create is backing off a 429) */
  retryNote?: string;
  /** خيارات ما بعد التوليد: تعليق صوتي + موسيقى خلفية + صيغة الملف */
  speech?: { text: string; voice?: string };
  music?: boolean;
  format?: "mp4" | "webm" | "gif";
}

type VideoJobGlobal = { smartVideoJobs?: Map<string, SmartVideoJob> };
const g = globalThis as unknown as VideoJobGlobal;
if (!g.smartVideoJobs) g.smartVideoJobs = new Map();
export const smartVideoJobs: Map<string, SmartVideoJob> = g.smartVideoJobs;

const STAGES = {
  thinking: { key: "thinking", ar: "القراءة والتحليل والتفكير…", en: "Reading, analyzing & thinking…", percent: 12 },
  generating: { key: "generating", ar: "توليد الفيديو (CogVideoX-3)…", en: "Generating video (CogVideoX-3)…", percent: 55 },
  downloading: { key: "downloading", ar: "تنزيل الفيديو وتجهيزه…", en: "Downloading & preparing video…", percent: 90 },
  done: { key: "done", ar: "تم", en: "Done", percent: 100 },
  error: { key: "error", ar: "فشل", en: "Failed", percent: 100 },
} as const;

function setStage(job: SmartVideoJob, s: keyof typeof STAGES) {
  const st = STAGES[s];
  job.status = s as SmartVideoJob["status"];
  job.stage = st.key;
  job.stageLabelAr = st.ar;
  job.stageLabelEn = st.en;
  job.percent = st.percent;
  job.updatedAt = Date.now();
}

/**
 * Video task backends:
 *   1. ZHIPU_API_KEY (env or DB llm:zhipu_key) → the PUBLIC z.ai/Zhipu open
 *      platform (open.bigmodel.cn) — cogvideox-3 via REST, works ANYWHERE
 *      including Codespaces. Get a free key at https://open.bigmodel.cn.
 *   2. The built-in z-ai SDK (internal gateway) — only reachable from the
 *      Z.ai sandbox / local server environment.
 */
async function zhipuApiKey(): Promise<string> {
  const env = process.env?.ZHIPU_API_KEY?.trim() || "";
  if (env) return env;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "llm:zhipu_key" } }).catch(() => null);
    return row?.value?.trim() || "";
  } catch {
    return "";
  }
}

/** Detect a 429 rate-limit error from the z-ai SDK / fetch. */
function is429(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes("429") || m.toLowerCase().includes("too many requests");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** خيارات إنشاء مهمة الفيديو — صورة→فيديو لحفظ الملامح + جودة/مدة/مقاس/صوت */
export interface VideoCreateOpts {
  prompt: string;
  /** صورة الإطار الأول (data URL) — توليد من صورة يحافظ على ملامح الأشخاص */
  imageDataUrl?: string;
  quality?: "speed" | "quality";
  size?: string;
  fps?: number;
  duration?: number;
  withAudio?: boolean;
}

async function createVideoTask(opts: VideoCreateOpts): Promise<{ taskId: string; backend: string }> {
  const zhipu = await zhipuApiKey();
  if (zhipu) {
    const body: Record<string, unknown> = { model: "cogvideox-3", prompt: opts.prompt };
    if (opts.imageDataUrl) body.image_url = opts.imageDataUrl;
    if (opts.quality) body.quality = opts.quality;
    if (opts.withAudio !== undefined) body.with_audio = opts.withAudio;
    const res = await fetch("https://open.bigmodel.cn/api/paas/v4/videos/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${zhipu}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Zhipu video API ${res.status}: ${t.slice(0, 160)}`);
    }
    const data = (await res.json()) as { id?: string; task_id?: string };
    const taskId = data?.id || data?.task_id;
    if (!taskId) throw new Error("Zhipu video API did not return a task id");
    return { taskId, backend: "zhipu-public" };
  }

  // z-ai internal gateway — it rate-limits video creates (429), so retry
  // patiently with backoff inside the background job (the client is polling,
  // nobody is waiting on this request).
  const ZAIModule = await import("z-ai-web-dev-sdk");
  const zai = await (ZAIModule.default).create();
  const DELAYS = [0, 12_000, 25_000, 45_000];
  for (let attempt = 0; attempt < DELAYS.length; attempt++) {
    if (DELAYS[attempt]) await sleep(DELAYS[attempt]);
    try {
      const createRes = (await zai.video.generations.create({
        prompt: opts.prompt,
        ...(opts.imageDataUrl ? { image_url: opts.imageDataUrl } : {}),
        ...(opts.quality ? { quality: opts.quality } : {}),
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.fps ? { fps: opts.fps } : {}),
        ...(opts.duration ? { duration: opts.duration } : {}),
        ...(opts.withAudio !== undefined ? { with_audio: opts.withAudio } : {}),
      } as never)) as {
        id?: string; task_id?: string; taskId?: string;
      };
      const taskId = createRes?.id || createRes?.task_id || createRes?.taskId;
      if (!taskId) throw new Error("لم يُرجع مولّد الفيديو معرّف مهمة");
      if (attempt > 0) console.log(`[smart-generation] video create succeeded on retry ${attempt}`);
      return { taskId, backend: "zai-internal" };
    } catch (e) {
      if (is429(e)) {
        console.warn(`[smart-generation] video create 429 (attempt ${attempt + 1}/${DELAYS.length}) — backing off`);
        continue;
      }
      throw e; // non-rate-limit errors fail fast
    }
  }
  throw new Error(
    "مولّد الفيديو مشغول حالياً (تم تجاوز حد معدل الطلبات). انتظر دقيقة واحدة ثم أعد المحاولة. / Video generator is rate-limited (429) after retries — wait a minute and try again."
  );
}

async function queryVideoTask(taskId: string, backend: string): Promise<{
  status: string;
  videoUrl?: string;
  coverUrl?: string;
}> {
  if (backend === "zhipu-public") {
    const zhipu = await zhipuApiKey();
    const res = await fetch(`https://open.bigmodel.cn/api/paas/v4/async-result/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${zhipu}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Zhipu poll ${res.status}`);
    const data = (await res.json()) as {
      task_status?: string;
      video_result?: Array<{ url?: string; cover_image_url?: string }>;
    };
    return {
      status: String(data?.task_status || "").toUpperCase(),
      videoUrl: data?.video_result?.[0]?.url,
      coverUrl: data?.video_result?.[0]?.cover_image_url,
    };
  }

  const ZAIModule = await import("z-ai-web-dev-sdk");
  const zai = await (ZAIModule.default).create();
  const q = (await zai.async.result.query(taskId)) as {
    task_status?: string;
    video_result?: Array<{ url?: string; cover_image_url?: string }>;
  };
  return {
    status: String(q?.task_status || "").toUpperCase(),
    videoUrl: q?.video_result?.[0]?.url,
    coverUrl: q?.video_result?.[0]?.cover_image_url,
  };
}

/**
 * Start the smart video pipeline (non-blocking):
 *   [1-3] analysis runs inline (a few seconds) so the UI can already show
 *         what the model understood, then the CogVideoX-3 task starts and
 *         the client polls GET ?jobId= (see pollSmartVideoJob).
 */
export async function startSmartVideoJob(opts: {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** جودة التوليد: سرعة أو جودة قصوى */
  quality?: "speed" | "quality";
  /** مقاس العرض (مثل 1280x720) — الافتراضي حسب نسبة الأبعاد */
  size?: string;
  fps?: number;
  /** مدة الفيديو بالثواني (5 أو 10) */
  duration?: number;
  /** توليد صوت/مؤثرات مع الفيديو */
  withAudio?: boolean;
  /** مسار صورة الإطار الأول (صورة→فيديو — يحفظ ملامح الأشخاص الحقيقية) */
  imagePath?: string;
  /** تعليق صوتي بالكلام (اللغة واللهجة تتبع النص المكتوب) */
  speech?: { text: string; voice?: string };
  /** موسيقى خلفية هادئة مولّدة محليًا */
  music?: boolean;
  /** صيغة الملف النهائي */
  format?: "mp4" | "webm" | "gif";
}): Promise<SmartVideoJob> {
  const jobId = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: SmartVideoJob = {
    jobId,
    status: "thinking",
    percent: 5,
    stage: "thinking",
    stageLabelAr: STAGES.thinking.ar,
    stageLabelEn: STAGES.thinking.en,
    analysis: null,
    model: "cogvideox-3",
    taskId: null,
    result: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    speech: opts.speech?.text?.trim() ? { text: opts.speech.text.trim().slice(0, 900), voice: opts.speech.voice } : undefined,
    music: !!opts.music,
    format: opts.format === "webm" || opts.format === "gif" ? opts.format : "mp4",
  };
  smartVideoJobs.set(jobId, job);

  void (async () => {
    try {
      // [1-3] READ → ANALYZE → THINK
      job.analysis = await analyzeRequest(opts.prompt, "video", opts.aspectRatio);

      // [4] GENERATE — CogVideoX-3 (Zhipu public API or built-in gateway)
      setStage(job, "generating");
      job.retryNote = "جارٍ بدء مهمة الفيديو… (إن كان المولّد مشغولاً سنُعيد المحاولة تلقائياً)";
      // صورة الإطار الأول: تخفيض الأبعاد لضمان قبول الحجم مع الحفاظ على الملامح
      let imageDataUrl: string | undefined;
      if (opts.imagePath) {
        try {
          const buf = await sharp(opts.imagePath).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
          imageDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
        } catch {
          imageDataUrl = undefined;
        }
      }
      const { taskId, backend } = await createVideoTask({
        prompt: job.analysis.enhancedPrompt,
        imageDataUrl,
        quality: opts.quality,
        size: opts.size,
        fps: opts.fps,
        duration: opts.duration,
        withAudio: opts.withAudio,
      });
      job.retryNote = undefined;
      job.taskId = taskId;
      job.backend = backend;

      await logEvent({
        category: "system",
        message: `Smart video gen started: ${taskId} (thinker=${job.analysis.provider}, backend=${backend})`,
        details: job.analysis.enhancedPrompt.slice(0, 160),
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const unreachable =
        raw.includes("fetch failed") || raw.includes("internal-api") || raw.includes("ENOTFOUND") || raw.includes("ETIMEDOUT");
      if (unreachable) {
        job.errorMessage =
          "مولّد الفيديو الداخلي غير متاح من هذه البيئة (يعمل داخل بيئة Z.ai والخادم المحلي). الحل: أضف مفتاح ZHIPU_API_KEY مجاني من open.bigmodel.cn في صفحة المفاتيح أو متغير البيئة، وسيعمل من أي مكان.";
      } else if (is429(e)) {
        job.errorMessage =
          "مولّد الفيديو مشغول الآن — تم تجاوز حد معدل الطلبات مؤقتاً. انتظر دقيقة واحدة ثم اضغط توليد مرة أخرى.";
      } else {
        job.errorMessage = raw;
      }
      setStage(job, "error");
      await logEvent({
        category: "system", level: "error",
        message: "Smart video gen failed to start",
        details: raw,
      });
    }
  })();

  return job;
}

// ============================================================
// ما بعد التوليد: تعليق صوتي (TTS) + موسيقى خلفية + تحويل الصيغة
// ============================================================

async function ffprobeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** تعليق صوتي عبر TTS — اللغة واللهجة تتبع النص المكتوب نفسه */
async function synthSpeech(outWav: string, speech: { text: string; voice?: string }): Promise<boolean> {
  try {
    const Z = (await import("z-ai-web-dev-sdk")).default;
    const zai = await Z.create();
    const response = (await zai.audio.tts.create({
      input: speech.text.slice(0, 950),
      voice: speech.voice || "tongtong",
      speed: 1.0,
      response_format: "wav",
      stream: false,
    } as never)) as { arrayBuffer: () => Promise<ArrayBuffer> };
    const buf = Buffer.from(new Uint8Array(await response.arrayBuffer()));
    if (buf.length < 100) return false;
    await fs.writeFile(outWav, buf);
    return true;
  } catch (e) {
    console.warn("[smart-generation] speech TTS failed (skipped):", e instanceof Error ? e.message : e);
    return false;
  }
}

/** موسيقى خلفية هادئة مولّدة محليًا (طبقة وتريات ناعمة — بدون أي خدمة خارجية) */
async function synthMusic(outWav: string, durationSec: number): Promise<boolean> {
  try {
    const d = Math.max(3, Math.min(60, Math.ceil(durationSec || 10)));
    await execFile("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `sine=frequency=110:duration=${d}`,
      "-f", "lavfi", "-i", `sine=frequency=164.81:duration=${d}`,
      "-f", "lavfi", "-i", `sine=frequency=220:duration=${d}`,
      "-f", "lavfi", "-i", `sine=frequency=277.18:duration=${d}`,
      "-f", "lavfi", "-i", `sine=frequency=329.63:duration=${d}`,
      "-filter_complex",
      "[0:a][1:a][2:a][3:a][4:a]amix=inputs=5:normalize=1,tremolo=f=0.25:d=0.7,lowpass=f=850,aformat=sample_rates=44100:channel_layouts=stereo,volume=0.35[a]",
      "-map", "[a]", outWav,
    ]);
    return true;
  } catch (e) {
    console.warn("[smart-generation] music synth failed (skipped):", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * يعالج الفيديو الخام بعد التنزيل ويكتب الناتج النهائي:
 *   تعليق صوتي (TTS) + موسيقى خلفية + صوت الفيديو الأصلي (المؤثرات)
 *   → دمجها معًا ثم تحويل الصيغة (mp4/webm/gif).
 * mp4 بلا خيارات = نسخ مباشر بدون إعادة ترميز.
 */
async function finalizeVideo(rawPath: string, job: SmartVideoJob, outPath: string): Promise<void> {
  const fmt = job.format ?? "mp4";
  const speechWav = job.speech?.text ? rawPath.replace(/-raw\.mp4$/, ".speech.wav") : "";
  const musicWav = job.music ? rawPath.replace(/-raw\.mp4$/, ".music.wav") : "";

  if (speechWav) await synthSpeech(speechWav, { text: job.speech!.text, voice: job.speech!.voice });
  if (musicWav) await synthMusic(musicWav, await ffprobeDuration(rawPath));
  const okSpeech = !!(speechWav && (await fs.stat(speechWav).then(() => true).catch(() => false)));
  const okMusic = !!(musicWav && (await fs.stat(musicWav).then(() => true).catch(() => false)));
  const needMix = okSpeech || okMusic;

  // GIF: بلا صوت — لوحة ألوان من تمريرتين
  if (fmt === "gif") {
    const palette = rawPath.replace(/-raw\.mp4$/, ".palette.png");
    await execFile("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-vf", "fps=12,scale=640:-1:flags=lanczos,palettegen", palette]);
    await execFile("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath, "-i", palette, "-lavfi", "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse", "-loop", "0", outPath]);
    return;
  }

  if (fmt === "mp4" && !needMix) {
    await fs.copyFile(rawPath, outPath);
    return;
  }

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-i", rawPath];
  const chains: string[] = [];
  const mixInputs: string[] = [];
  let ai = 1;
  if (okSpeech) { args.push("-i", speechWav); chains.push(`[${ai}:a]volume=1.0[ps]`); mixInputs.push("[ps]"); ai++; }
  if (okMusic) { args.push("-i", musicWav); chains.push(`[${ai}:a]volume=0.9[pm]`); mixInputs.push("[pm]"); ai++; }
  // صوت الفيديو الأصلي (مؤثرات CogVideoX عند with_audio) بمستوى أخف عند وجود كلام
  if (needMix && (await hasAudioStream(rawPath))) {
    chains.push(`[0:a]volume=${okSpeech ? 0.6 : 0.9}[pv]`);
    mixInputs.unshift("[pv]");
  }

  if (needMix) {
    const filter = `${chains.join(";")};${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:normalize=0[aout]`;
    args.push("-filter_complex", filter, "-map", "0:v", "-map", "[aout]");
  }
  if (fmt === "webm") {
    args.push("-c:v", "libvpx-vp9", "-b:v", "2M", "-c:a", needMix ? "libopus" : "", "-b:a", "128k", "-shortest");
  } else {
    args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest");
  }
  args.push(outPath);
  await execFile("ffmpeg", args.filter(Boolean));
}

export async function pollSmartVideoJob(jobId: string): Promise<SmartVideoJob | undefined> {
  const job = smartVideoJobs.get(jobId);
  if (!job) return undefined;

  // Throttle gateway queries: the client polls every ~4s, but the backend
  // (z-ai gateway / Zhipu) only needs (and allows) far fewer queries.
  // Answer intermediate polls from the cached job state instead.
  const GATEWAY_MIN_INTERVAL = 8000;
  if (job.status === "generating" && job.taskId) {
    const since = Date.now() - (job.lastGatewayQueryAt ?? 0);
    if (since < GATEWAY_MIN_INTERVAL) {
      return job; // too soon — serve cached state, no gateway call
    }
    job.lastGatewayQueryAt = Date.now();
    try {
      const q = await queryVideoTask(job.taskId, job.backend || "zai-internal");
      const st = q.status;

      if (st === "SUCCESS" && q.videoUrl) {
        setStage(job, "downloading");
        job.stageLabelAr = "تنزيل الفيديو وإضافة الصوت والمؤثرات…";
        job.stageLabelEn = "Downloading & mixing audio…";
        const remote = q.videoUrl;
        const cover = q.coverUrl || "";
        // download locally (remote URL expires)
        const res = await fetch(remote);
        if (!res.ok) throw new Error(`تنزيل الفيديو فشل (HTTP ${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.mkdir(RESULTS_ROOT, { recursive: true });
        const base = `smart-video-${Date.now()}`;
        const rawPath = path.join(RESULTS_ROOT, `${base}-raw.mp4`);
        await fs.writeFile(rawPath, buf);

        // ما بعد التوليد: تعليق صوتي + موسيقى + صيغة — فشلها لا يُسقط النتيجة
        let finalPath = rawPath;
        try {
          finalPath = path.join(RESULTS_ROOT, `${base}.${job.format ?? "mp4"}`);
          await finalizeVideo(rawPath, job, finalPath);
        } catch (e) {
          console.warn("[smart-generation] video post-process failed, delivering raw mp4:", e instanceof Error ? e.message : e);
          finalPath = rawPath;
        }
        // تنظيف الملفات الوسيطة والخام
        for (const suffix of ["-raw.mp4", ".speech.wav", ".music.wav", ".palette.png"]) {
          const f = path.join(RESULTS_ROOT, `${base}${suffix}`);
          if (f !== finalPath) fs.unlink(f).catch(() => {});
        }

        const fbuf = await fs.stat(finalPath).catch(() => null);
        job.result = {
          url: `/results/${path.basename(finalPath)}`,
          remoteUrl: remote,
          coverUrl: cover,
          sizeMB: Math.round(((fbuf?.size ?? buf.length) / 1024 / 1024) * 10) / 10,
          format: path.extname(finalPath).replace(".", "") || "mp4",
          hasSpeech: !!job.speech?.text,
          hasMusic: !!job.music,
        };
        setStage(job, "done");
        await logEvent({
          category: "system",
          message: `Smart video gen OK: ${path.basename(finalPath)} (${job.result.sizeMB}MB, ${Math.round((Date.now() - job.startedAt) / 1000)}s)`,
        });
      } else if (st === "FAILED" || st === "ERROR") {
        job.errorMessage = "فشل مولّد الفيديو في إنتاج المقطع — جرّب وصفاً آخر.";
        setStage(job, "error");
      } else {
        // still processing — gentle progress creep for the UI
        job.percent = Math.min(88, job.percent + 2);
        job.updatedAt = Date.now();
      }
    } catch (e) {
      // transient polling errors are tolerated (incl. gateway 429s); log softly
      const msg = e instanceof Error ? e.message : String(e);
      if (msg && !msg.includes("429")) {
        console.warn("[smart-generation] video poll error:", msg);
      }
    }
  }

  return job;
}

const ASPECT_DIMS: Record<AspectRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
};

/**
 * Generate one image:
 *   1st choice — z-ai CogView (built-in SDK, no key, works in Codespaces;
 *                this is the same engine the try-on pipeline uses).
 *   fallback  — Pollinations/Flux (free; 402s/429s under load).
 */
async function generateImageOnce(opts: {
  prompt: string;
  negative?: string;
  width: number;
  height: number;
  seed?: number;
}): Promise<{ dataUrl: string; engine: string }> {
  // --- z-ai CogView (primary) ---
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await (ZAIModule.default).create();
    const fullPrompt = opts.negative
      ? `${opts.prompt}\n\nAVOID: ${opts.negative}`
      : opts.prompt;
    const res = (await zai.images.generations.create({
      prompt: fullPrompt,
      size: `${opts.width}x${opts.height}`,
    } as never)) as { data?: Array<{ base64?: string }> };
    const b64 = res?.data?.[0]?.base64;
    if (b64) {
      return { dataUrl: `data:image/png;base64,${b64}`, engine: "zai-cogview" };
    }
  } catch (e) {
    console.warn("[smart-generation] z-ai image failed, trying pollinations:", e instanceof Error ? e.message : e);
  }
  // --- Pollinations (fallback) ---
  const gen = await generateImageBase64({
    prompt: opts.prompt,
    negative: opts.negative,
    width: opts.width,
    height: opts.height,
    seed: opts.seed,
    model: "flux",
  });
  return { dataUrl: gen.dataUrl, engine: "pollinations-flux" };
}

// ============================================================
// FULL IMAGE PIPELINE (async job — mirrors the video pipeline).
// Why: the old synchronous POST ran 20-70s+; preview proxies cut
// long requests and return an HTML error page, so the client got
// `res.json()` → "Unexpected token '<'… is not valid JSON".
// Jobs return a jobId instantly and the client polls instead.
// ============================================================

export type SmartImageStage = "thinking" | "generating" | "reviewing" | "done" | "error";

export interface SmartImageJob {
  jobId: string;
  status: SmartImageStage;
  percent: number;
  stage: string;
  stageLabelAr: string;
  stageLabelEn: string;
  prompt: string;
  analysis: SmartAnalysis | null;
  result: SmartImageResult | null;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
}

type ImageJobGlobal = { smartImageJobs?: Map<string, SmartImageJob> };
const gi = globalThis as unknown as ImageJobGlobal;
if (!gi.smartImageJobs) gi.smartImageJobs = new Map();
export const smartImageJobs: Map<string, SmartImageJob> = gi.smartImageJobs;

const IMG_STAGES = {
  thinking: { key: "thinking", ar: "القراءة والتحليل والتفكير…", en: "Reading, analyzing & thinking…", percent: 15 },
  generating: { key: "generating", ar: "توليد الصورة…", en: "Generating image…", percent: 55 },
  reviewing: { key: "reviewing", ar: "تدقيق النتيجة وتقييمها…", en: "Reviewing & scoring…", percent: 85 },
  done: { key: "done", ar: "تم", en: "Done", percent: 100 },
  error: { key: "error", ar: "فشل", en: "Failed", percent: 100 },
} as const;

function setImgStage(job: SmartImageJob, s: keyof typeof IMG_STAGES) {
  const st = IMG_STAGES[s];
  job.status = s as SmartImageStage;
  job.stage = st.key;
  job.stageLabelAr = st.ar;
  job.stageLabelEn = st.en;
  job.percent = st.percent;
  job.updatedAt = Date.now();
}

/** Start the smart image pipeline in the background; poll with pollSmartImageJob. */
export function startSmartImageJob(opts: {
  prompt: string;
  aspectRatio?: AspectRatio;
  seed?: number;
}): SmartImageJob {
  const jobId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: SmartImageJob = {
    jobId,
    status: "thinking",
    percent: 5,
    stage: "thinking",
    stageLabelAr: IMG_STAGES.thinking.ar,
    stageLabelEn: IMG_STAGES.thinking.en,
    prompt: opts.prompt,
    analysis: null,
    result: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  smartImageJobs.set(jobId, job);
  void runSmartImagePipeline(job, opts);
  return job;
}

/** Core pipeline — mutates the job in place (never throws). */
async function runSmartImagePipeline(
  job: SmartImageJob,
  opts: { prompt: string; aspectRatio?: AspectRatio; seed?: number }
): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  let critique: { score: number; note: string; fix: string } | null = null;
  let lastError: string | undefined;
  const maxAttempts = 2;

  try {
    // [1-3] READ → ANALYZE → THINK
    const analysis = await analyzeRequest(opts.prompt, "image", opts.aspectRatio);
    job.analysis = analysis;

    const [w, h] = ASPECT_DIMS[analysis.aspectRatio] ?? ASPECT_DIMS["1:1"];
    let imageEngine = "zai-cogview";

    while (attempt < maxAttempts) {
      attempt++;
      const promptForModel =
        attempt === 1
          ? analysis.enhancedPrompt
          : `${analysis.enhancedPrompt}. IMPORTANT FIX FROM REVIEW: ${critique?.fix || "improve overall quality"}`;

      try {
        setImgStage(job, "generating");
        const gen = await generateImageOnce({
          prompt: promptForModel,
          negative: analysis.negativePrompt,
          width: w,
          height: h,
          seed: opts.seed !== undefined ? opts.seed + attempt : undefined,
        });
        imageEngine = gen.engine;

        // [5] REVIEW — VLM scoring; one smart retry max
        setImgStage(job, "reviewing");
        critique = await critiqueImage(gen.dataUrl, analysis.understanding, analysis.enhancedPrompt);

        const shouldRetry = critique.score < 70 && critique.fix && attempt < maxAttempts;
        if (shouldRetry) {
          await logEvent({
            category: "system",
            message: `Smart image gen: attempt ${attempt} scored ${critique.score} — retrying with fix`,
            details: critique.fix,
          });
          continue;
        }

        // Save the accepted image
        await fs.mkdir(RESULTS_ROOT, { recursive: true });
        const fileName = `smart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        const outPath = path.join(RESULTS_ROOT, fileName);
        const png = await sharp(Buffer.from(gen.dataUrl.slice(gen.dataUrl.indexOf(",") + 1), "base64")).png().toBuffer();
        await fs.writeFile(outPath, png);
        const meta = await sharp(png).metadata();

        await logEvent({
          category: "system",
          message: `Smart image gen OK: ${fileName} (attempts=${attempt}, score=${critique.score}, thinker=${analysis.provider})`,
          durationMs: Date.now() - startedAt,
        });

        job.result = {
          ok: true,
          path: `data/results/${fileName}`,
          url: `/results/${fileName}`,
          width: meta.width ?? w,
          height: meta.height ?? h,
          analysis,
          attempts: attempt,
          critique: { score: critique.score, note: critique.note },
          provider: analysis.provider,
          imageModel: imageEngine,
        };
        setImgStage(job, "done");
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[smart-generation] image attempt ${attempt} failed:`, lastError);
        if (attempt >= maxAttempts) break;
        setImgStage(job, "generating"); // retry
      }
    }

    await logEvent({
      category: "system", level: "error",
      message: "Smart image gen failed (all attempts)",
      details: lastError,
    });
    job.result = {
      ok: false,
      path: "", url: "", width: 0, height: 0,
      analysis,
      attempts: attempt,
      critique,
      provider: analysis.provider,
      imageModel: "zai-cogview",
      errorMessage: lastError || "فشل التوليد بعد كل المحاولات",
    };
    job.errorMessage = lastError || "فشل التوليد بعد كل المحاولات";
    setImgStage(job, "error");
  } catch (e) {
    // Safety net — the pipeline itself should never throw
    job.errorMessage = e instanceof Error ? e.message : String(e);
    setImgStage(job, "error");
  }
}

/** Poll a smart-image job (cheap: reads the in-memory map only). */
export async function pollSmartImageJob(jobId: string): Promise<SmartImageJob | undefined> {
  return smartImageJobs.get(jobId);
}
