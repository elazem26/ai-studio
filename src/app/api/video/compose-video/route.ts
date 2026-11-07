import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask, getTask } from "@/lib/task-store";
import { resolveFilePath, dataRootSync } from "@/lib/security/resolve-file-path";
import {
  describePeople,
  planScene,
  searchPortraits,
  composeScene,
  lockIdentities,
  loadPersonDataUrl,
  saveResult,
  COMPOSE_SIZES,
  type PersonImage,
} from "@/lib/composer-engine";
import { ensureTmp, synthMusic, packageVideo, extractPoster, probeVideo, runFfmpeg, type VideoStyle } from "@/lib/ffmpeg-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/video/compose-video — وكيل «توليد فيديو من الصور» (صفحة أدوات الفيديو)
 *
 * نفس فكرة وكيل الصور: عدة صور لأشخاص (مصدر/مرجع) + طلب لغوي طبيعي
 * ← يبني الوكيل صورة المشهد (بحفظ الملامح) ثم يحرّكها في فيديو
 * مع تحكم كامل: الجودة، المدة، الحجم، الكادر، الصيغة، النمط،
 * والصوت (تعليق صوتي بلغة/سرعة + موسيقى خلفية مولّدة).
 *
 * الجسم:
 *   imagePaths?: string[]     — صور الأشخاص (اختياري — بدونها فيديو نصي)
 *   instruction: string       — فكرة الفيديو
 *   size?: string             — مقاس صورة المشهد (من COMPOSE_SIZES)
 *   videoSize?: string        — "1920x1080" | "1280x720" | "1080x1920" | "720x1280" | "1024x1024"
 *   quality?: "speed"|"quality"
 *   durationSec?: 5|10
 *   fps?: 24|30
 *   format?: "mp4"|"webm"|"gif"
 *   style?: "cinematic"|"realistic"|"warm"|"bw"
 *   audio?: { native?, narration?: { enabled?, script?, lang?, voice?, speed? }, music? }
 *   lockFaces?: boolean       — افتراضي true
 *
 * الرد: { taskId } ثم poll /api/task/status?id=
 */

const VIDEO_SIZES = ["1920x1080", "1280x720", "1080x1920", "720x1280", "1024x1024"] as const;
type VideoSize = (typeof VIDEO_SIZES)[number];

const LANGS: Record<string, string> = {
  "ar-MSA": "العربية الفصحى",
  "ar-EG": "العربية المصرية",
  "ar-GULF": "العربية الخليجية",
  en: "English",
};

const DATA_ROOT = dataRootSync();
const RESULTS_ROOT = path.join(DATA_ROOT, "results");

function normPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).slice(0, 4);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const instruction: string = (body.instruction ?? "").toString().trim();
  if (!instruction) return NextResponse.json({ error: "اكتب فكرة الفيديو أولًا" }, { status: 400 });
  if (instruction.length > 2000) return NextResponse.json({ error: "النص طويل جدًا" }, { status: 400 });

  const imagePaths = normPaths(body.imagePaths);
  const resolvedImages: string[] = [];
  try {
    for (const p of imagePaths) resolvedImages.push(await resolveFilePath(p));
  } catch {
    return NextResponse.json({ error: "Image file not found" }, { status: 404 });
  }

  const size = (COMPOSE_SIZES as readonly string[]).includes(body.size) ? body.size : "1344x768";
  const videoSize: VideoSize = (VIDEO_SIZES as readonly string[]).includes(body.videoSize) ? body.videoSize : "1280x720";
  const quality: "speed" | "quality" = body.quality === "quality" ? "quality" : "speed";
  const durationSec: number = Number(body.durationSec) === 10 ? 10 : 5;
  const fps: number = Number(body.fps) === 24 ? 24 : 30;
  const format: "mp4" | "webm" | "gif" = ["mp4", "webm", "gif"].includes(body.format) ? body.format : "mp4";
  const style: VideoStyle = (["cinematic", "realistic", "warm", "bw"] as const).includes(body.style) ? body.style : "cinematic";
  const lockFaces: boolean = body.lockFaces !== false;
  const audio = {
    native: !!body.audio?.native,
    narration: {
      enabled: !!body.audio?.narration?.enabled,
      script: typeof body.audio?.narration?.script === "string" ? body.audio.narration.script.slice(0, 400) : "",
      lang: typeof body.audio?.narration?.lang === "string" && LANGS[body.audio.narration.lang] ? body.audio.narration.lang : "ar-MSA",
      voice: typeof body.audio?.narration?.voice === "string" && body.audio.narration.voice ? body.audio.narration.voice : undefined,
      speed: Math.min(2, Math.max(0.5, Number(body.audio?.narration?.speed) || 1)),
    },
    music: ["none", "ambient", "upbeat"].includes(body.audio?.music) ? body.audio.music : "ambient",
  };

  const taskId = createTask("Compose Video");
  (async () => {
    let tmpFiles: string[] = [];
    try {
      // ---------- 1) فهم ----------
      updateTask(taskId, { status: "processing", progress: 4, phase: "understand", meta: { format, style, durationSec } });

      // ---------- 2) تحليل: تخطيط المشهد + حركة الكاميرا + نص التعليق ----------
      updateTask(taskId, { progress: 10, phase: "analyze", meta: { stage: "plan" } });

      const people: PersonImage[] = [];
      for (const p of resolvedImages) people.push({ path: p, role: "source" });
      if (people.length) {
        const dataUrls = await Promise.all(
          people.map(async (p) => {
            try {
              return await loadPersonDataUrl(p.path);
            } catch {
              return "";
            }
          })
        );
        const descs = await describePeople(dataUrls.filter(Boolean));
        let di = 0;
        for (let i = 0; i < people.length; i++) {
          if (dataUrls[i]) {
            (people[i] as any).dataUrl = dataUrls[i];
            people[i].desc = descs[di] || undefined;
            di++;
          }
        }
      }

      const plan = await planScene({
        instruction,
        people: people.map((p) => ({ role: p.role, name: p.name, desc: p.desc })),
        poses: [],
        userSize: size,
        mode: people.length ? "compose" : "edit",
      });

      // بحث عن شخصيات بالاسم (إن وُجدت) — نفس آلية وكيل الصور
      if (people.length && plan.searches.length) {
        updateTask(taskId, { progress: 16, phase: "analyze", meta: { stage: "search", searching: plan.searches.map((s) => s.name) } });
        const searched = await searchPortraits(plan.searches);
        people.push(...searched);
      }

      // خطة الفيديو: حركة كاميرا + نص التعليق الصوتي
      let videoPrompt = `${plan.prompt}. Cinematic single continuous shot, smooth camera motion, subjects moving naturally.`;
      let narrationScript = audio.narration.script;
      try {
        const Z = (await import("z-ai-web-dev-sdk")).default;
        const zai = await Z.create();
        updateTask(taskId, { progress: 20, phase: "analyze", meta: { stage: "video-plan" } });
        const cr = await zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                "You are a video director. Given a scene description, output ONLY JSON: " +
                '{"videoPrompt": "ENGLISH video-model prompt: same scene + ONE continuous camera movement (slow dolly-in / orbit / pan) + how subjects move, 50-90 words"' +
                (audio.narration.enabled && !narrationScript
                  ? `, "narrationScript": "short narration (max 35 words) in ${LANGS[audio.narration.lang]} that fits the scene, warm storytelling tone"`
                  : "") +
                "}",
            },
            { role: "user", content: `Scene: ${plan.prompt}\nDuration: ${durationSec}s. Output the JSON now.` },
          ],
          thinking: { type: "disabled" },
        });
        const raw = cr?.choices?.[0]?.message?.content?.toString?.() ?? "";
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const j = JSON.parse(m[0]);
          if (typeof j.videoPrompt === "string" && j.videoPrompt.trim()) videoPrompt = j.videoPrompt.trim().slice(0, 900);
          if (audio.narration.enabled && !narrationScript && typeof j.narrationScript === "string") {
            narrationScript = j.narrationScript.trim().slice(0, 400);
          }
        }
      } catch {
        /* الوصف الافتراضي كافٍ */
      }

      // ---------- 3) بناء صورة المشهد ----------
      let sceneDataUrl = "";
      let sceneMethod = "";
      let locked = 0;
      let lockNote = "";

      if (people.length) {
        updateTask(taskId, { progress: 28, phase: "apply", meta: { stage: "scene-compose", images: people.length } });
        const dataUrls = people.map((p) => p.dataUrl).filter(Boolean) as string[];
        if (!dataUrls.length) throw new Error("لا توجد صور صالحة للأشخاص");
        const out = await composeScene({ dataUrls, prompt: plan.prompt, size: plan.size });
        sceneMethod = out.method;

        if (lockFaces) {
          updateTask(taskId, { progress: 42, phase: "apply", meta: { stage: "scene-lock" } });
          const lock = await lockIdentities({
            sceneBuffer: out.buffer,
            persons: people.filter((p) => p.dataUrl).map((p) => ({ dataUrl: p.dataUrl!, name: p.name })),
          });
          lockNote = lock.note;
          locked = lock.locked;
          sceneMethod += locked > 0 ? "+identity-lock" : "";
          sceneDataUrl = `data:image/png;base64,${lock.buffer.toString("base64")}`;
          const sceneName = await saveResult(lock.buffer, "compose-video-scene");
          updateTask(taskId, { meta: { sceneUrl: `/results/${sceneName}` } });
        } else {
          sceneDataUrl = `data:image/png;base64,${out.buffer.toString("base64")}`;
        }
      } else {
        // فيديو نصي — توليد إطار أساس ثم تحريكه (اتساق أعلى بين الإطارات)
        updateTask(taskId, { progress: 30, phase: "apply", meta: { stage: "scene-t2i" } });
        const Z = (await import("z-ai-web-dev-sdk")).default;
        const zai = await Z.create();
        const gen = await zai.images.generations.create({ prompt: plan.prompt, size: plan.size as never });
        const b64 = gen?.data?.[0]?.base64;
        if (!b64) throw new Error("تعذر توليد صورة المشهد الأساس");
        const buf = Buffer.from(b64, "base64");
        sceneDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
        sceneMethod = "text-to-image-scene";
        const sceneName = await saveResult(buf, "compose-video-scene");
        updateTask(taskId, { meta: { sceneUrl: `/results/${sceneName}` } });
      }

      // ---------- 4) توليد الفيديو من المشهد ----------
      updateTask(taskId, { progress: 50, phase: "apply", meta: { stage: "video-task", backend: "cogvideox" } });
      const Z = (await import("z-ai-web-dev-sdk")).default;
      const zai = await Z.create();

      let createRes: any = null;
      const attempts: any[] = [
        { prompt: videoPrompt, image_url: sceneDataUrl, quality, with_audio: audio.native, size: videoSize, fps, duration: durationSec },
        { prompt: videoPrompt, image_url: sceneDataUrl, quality, with_audio: audio.native },
        { prompt: videoPrompt, image_url: sceneDataUrl, quality },
        { prompt: videoPrompt, image_url: sceneDataUrl },
      ];
      let lastErr: unknown = null;
      let retries429 = 0;
      const MAX_429_RETRIES = 4; // انتظارات إضافية إجمالًا: 15+30+45+60 ثانية
      for (let ai = 0; ai < attempts.length; ai++) {
        const a = attempts[ai];
        try {
          createRes = await (zai.video.generations.create as any)(a);
          break;
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("1301") || msg.includes("contentFilter")) throw e;
          // 429 = حد معدل البوابة — انتظر ثم أعد المحاولة (وليس الانتقال لتوليفة أخرى)
          if (retries429 < MAX_429_RETRIES && (msg.includes("429") || msg.toLowerCase().includes("too many requests") || msg.includes("请求过快"))) {
            retries429++;
            const wait = 15000 * retries429;
            updateTask(taskId, { meta: { stage: "video-task", retry429: retries429, waitSec: Math.round(wait / 1000) } });
            await sleep(wait);
            ai--; // أعد نفس التوليفة بعد الانتظار
            continue;
          }
          await logEvent({ category: "video", level: "debug", message: "video create attempt failed → next", details: msg.slice(0, 200) });
        }
      }
      if (!createRes) throw lastErr instanceof Error ? lastErr : new Error("تعذر بدء مهمة الفيديو");

      const videoTaskId: string = createRes?.id || createRes?.task_id || createRes?.taskId;
      if (!videoTaskId) throw new Error("لم يصل معرّف مهمة الفيديو");

      // متابعة المهمة حتى 15 دقيقة
      let videoUrl = "";
      for (let i = 0; i < 150; i++) {
        await sleep(6000);
        try {
          const q: any = await zai.async.result.query(videoTaskId);
          const st = String(q?.task_status ?? q?.status ?? "").toUpperCase();
          const u = q?.video_result?.[0]?.url || q?.video_url || q?.url || q?.video;
          if (u) {
            videoUrl = String(u);
            if (st === "SUCCESS" || st === "PROCESSING") break;
          }
          if (st === "FAIL") throw new Error("فشل توليد الفيديو في المحرك");
          updateTask(taskId, { progress: Math.min(72, 52 + Math.round(i / 3)), meta: { stage: "video-generating", waitedSec: i * 6 } });
        } catch (e) {
          if (e instanceof Error && e.message.includes("فشل توليد الفيديو")) throw e;
          /* استمرار المتابعة */
        }
      }
      if (!videoUrl) throw new Error("انتهت مهلة توليد الفيديو — أعد المحاولة");

      updateTask(taskId, { progress: 76, phase: "finalizing", meta: { stage: "download" } });
      const tmp = await ensureTmp();
      const rawPath = path.join(tmp, `cvid-raw-${Date.now()}.mp4`);
      tmpFiles.push(rawPath);
      const ctrl = new AbortController();
      const dlTimer = setTimeout(() => ctrl.abort(), 180_000);
      const dlRes = await fetch(videoUrl, { signal: ctrl.signal });
      clearTimeout(dlTimer);
      if (!dlRes.ok) throw new Error(`تنزيل الفيديو فشل (HTTP ${dlRes.status})`);
      await fs.writeFile(rawPath, Buffer.from(await dlRes.arrayBuffer()));

      // ---------- 5) الصوت: تعليق صوتي + موسيقى ----------
      let narrationWav: string | undefined;
      let musicWav: string | undefined;
      let narrationNote = "";

      if (format !== "gif" && audio.narration.enabled && narrationScript) {
        updateTask(taskId, { progress: 82, phase: "finalizing", meta: { stage: "tts" } });
        try {
          const ttsRes = await zai.audio.tts.create({
            input: narrationScript.slice(0, 900),
            voice: audio.narration.voice ?? "tongtong",
            speed: audio.narration.speed,
            response_format: "wav",
            stream: false,
          });
          const ab = await ttsRes.arrayBuffer();
          const buf = Buffer.from(new Uint8Array(ab));
          if (buf.length > 1000) {
            narrationWav = path.join(tmp, `cvid-tts-${Date.now()}.wav`);
            tmpFiles.push(narrationWav);
            await fs.writeFile(narrationWav, buf);
          } else narrationNote = "تعذر توليد التعليق الصوتي";
        } catch {
          narrationNote = "تعذر توليد التعليق الصوتي";
        }
      }

      if (format !== "gif" && audio.music !== "none") {
        updateTask(taskId, { progress: 86, phase: "finalizing", meta: { stage: "music" } });
        musicWav = path.join(tmp, `cvid-music-${Date.now()}.wav`);
        tmpFiles.push(musicWav);
        const ok = await synthMusic(musicWav, durationSec + 1, audio.music as "ambient" | "upbeat");
        if (!ok) musicWav = undefined;
      }

      // ---------- 6) التغليف: نمط + دقة + كادر + صيغة ----------
      updateTask(taskId, { progress: 90, phase: "finalizing", meta: { stage: "package", style } });
      const [vw, vh] = videoSize.split("x").map(Number);
      const outName = `compose-video-${Date.now()}.${format}`;
      const outPath = path.join(RESULTS_ROOT, outName);
      const packed = await packageVideo({
        input: rawPath,
        out: outPath,
        format,
        fps,
        width: vw,
        height: vh,
        style,
        durationSec,
        narrationWav,
        musicWav,
      });
      if (!packed.ok) {
        // سقوط احتياطي: نسخة خام mp4 بدون تدرج
        await logEvent({ category: "video", level: "warn", message: "packageVideo failed → raw fallback", details: packed.stderr.slice(-300) });
        const fallback = path.join(RESULTS_ROOT, `compose-video-${Date.now()}.mp4`);
        await runFfmpeg(["-i", rawPath, "-c", "copy", fallback], 120_000);
        const probeF = await probeVideo(fallback);
        updateTask(taskId, {
          status: "done",
          progress: 100,
          phase: "done",
          result: {
            url: `/results/${path.basename(fallback)}`,
            path: fallback,
            format: "mp4",
            width: probeF?.width ?? 0,
            height: probeF?.height ?? 0,
            duration: probeF?.duration ?? durationSec,
            sizeMB: Math.round(((await fs.stat(fallback)).size / 1048576) * 10) / 10,
            style,
            method: sceneMethod,
            locked,
            lockNote,
            narrationScript: narrationWav ? narrationScript : "",
            narrationNote,
            degraded: "فشل التغليف النهائي — عُرض الفيديو الخام",
          },
        });
        return;
      }

      tmpFiles.forEach((f) => fs.unlink(f).catch(() => {}));
      tmpFiles = [];
      const probe = await probeVideo(outPath);
      const stat = await fs.stat(outPath);

      // ملصق للطباعة
      let posterUrl = "";
      const posterPath = outPath.replace(/\.\w+$/, "") + "-poster.jpg";
      if (await extractPoster(outPath, posterPath)) posterUrl = `/results/${path.basename(posterPath)}`;

      updateTask(taskId, {
        status: "done",
        progress: 100,
        phase: "done",
        result: {
          url: `/results/${outName}`,
          path: outPath,
          format,
          width: probe?.width ?? vw,
          height: probe?.height ?? vh,
          duration: probe?.duration ?? durationSec,
          sizeMB: Math.round((stat.size / 1048576) * 10) / 10,
          style,
          method: sceneMethod,
          locked,
          lockNote,
          narrationScript: narrationWav ? narrationScript : "",
          narrationNote,
          sceneUrl: getTask(taskId)?.meta?.sceneUrl ?? "",
          posterUrl,
          videoPrompt,
        },
      });
    } catch (e) {
      await logEvent({ category: "video", level: "error", message: "compose-video failed", details: e instanceof Error ? e.message : String(e) });
      updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      tmpFiles.forEach((f) => fs.unlink(f).catch(() => {}));
    }
  })();

  return NextResponse.json({ taskId, status: "pending", message: `Poll /api/task/status?id=${taskId}` });
}
