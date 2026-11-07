/**
 * FFmpeg Tools — معالجة الفيديو بعد التوليد لوكيل «توليد الفيديو من الصور»:
 *   - تشغيل ffmpeg بشكل آمن مع مهلة وجمع الأخطاء
 *   - توليد موسيقى خلفية إجرائية (بدون ملفات خارجية/حقوق)
 *   - تعليق صوتي عبر TTS → WAV
 *   - تدرج لوني حسب النمط (سينمائي/واقعي/دافئ/أبيض وأسود) + الكادر + الدقة
 *   - تغليف بالصيغة المطلوبة (MP4/WebM/GIF) + خلط التعليق والموسيقى
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { dataRootSync } from "@/lib/security/resolve-file-path";

/** مجلد المؤقتات الثابت (dataRootSync بدل cwd — الخادم المستقل يُمحى عند البناء) */
export const TMP_ROOT = path.join(dataRootSync(), "temp");

export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stderr: `${stderr}\n${e.message}` });
    });
  });
}

export async function ensureTmp(): Promise<string> {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  return TMP_ROOT;
}

// ============================================================
// موسيقى خلفية إجرائية (حقوق صفرية — تُصنّع رياضيًا)
// ============================================================

/**
 * موجة جيبية متعددة الطبقات = وسادة هارمونية هادئة.
 * ambient: أوتار Gmaj بطيئة | upbeat: إيقاع نبضي + طبقة أعلى.
 * التعبيرات تُقتبس بعلامات '...' لأن ffmpeg يفصل الفلاتر بفواصل —
 * والفاصلة داخل mod(t,0.5) يجب أن تبقى حرفية.
 */
export async function synthMusic(outWav: string, seconds: number, mood: "ambient" | "upbeat"): Promise<boolean> {
  const dur = Math.max(2, Math.min(120, seconds));
  if (mood === "ambient") {
    // وسادة ثلاثية (G3 D4 B4) مع نبض بطيء وخفض ترددات
    const expr =
      "(0.055*sin(2*PI*196*t)+0.05*sin(2*PI*293.66*t)+0.045*sin(2*PI*369.99*t))" +
      "*(0.75+0.25*sin(2*PI*0.12*t))*(0.7+0.3*sin(2*PI*0.05*t+1.3))";
    const r = await runFfmpeg([
      "-f", "lavfi", "-i", `aevalsrc='${expr}':s=44100:d=${dur}`,
      "-af", "lowpass=f=1200,aformat=sample_fmts=fltp:channel_layouts=stereo",
      "-c:a", "pcm_s16le", outWav,
    ], 60_000);
    return r.ok;
  }
  // upbeat: نبضات رباعية متتابعة على 220/330/440 مع تلاشٍ أسي + hi-hat ضوضائي خفيف
  const beat = "(1-exp(-12*mod(t,0.5)))";
  const expr =
    "(0.09*sin(2*PI*220*t)*" + beat + "+0.07*sin(2*PI*330*t)*" + beat + "+0.05*sin(2*PI*440*t)*" + beat + ")";
  const r = await runFfmpeg([
    "-f", "lavfi", "-i", `aevalsrc='${expr}':s=44100:d=${dur}`,
    "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.012:duration=${dur}`,
    "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.4[m];[m]lowpass=f=4000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]",
    "-map", "[a]", "-c:a", "pcm_s16le", outWav,
  ], 60_000);
  return r.ok;
}

// ============================================================
// التدرج اللوني حسب النمط
// ============================================================

export type VideoStyle = "cinematic" | "realistic" | "warm" | "bw";

const STYLE_VF: Record<VideoStyle, string[]> = {
  cinematic: ["colorbalance=rs=-0.04:bs=0.07", "eq=contrast=1.07:saturation=1.04:brightness=-0.01", "vignette=PI/5"],
  realistic: ["unsharp=5:5:0.35", "eq=contrast=1.02:saturation=1.02"],
  warm: ["colorbalance=rs=0.07:gs=0.02:bs=-0.05", "eq=contrast=1.04:saturation=1.08"],
  bw: ["hue=s=0", "eq=contrast=1.12:brightness=-0.01", "vignette=PI/6"],
};

export interface PackageOpts {
  input: string;
  out: string;
  format: "mp4" | "webm" | "gif";
  fps: number;
  width: number;
  height: number;
  style: VideoStyle;
  /** تقصير/إطالة الإطارات لتطابق المدة المستهدفة (ثوانٍ) */
  durationSec?: number;
  narrationWav?: string;
  musicWav?: string;
  musicVolume?: number;
  narrationVolume?: number;
}

/**
 * تجهيز الفيديو النهائي: تدرج + دقة (fit داخل الإطار + حواف سوداء) + كادر
 * + صوت مختلط (تعليق + موسيقى) + صيغة. GIF بلا صوت.
 */
export async function packageVideo(o: PackageOpts): Promise<{ ok: boolean; stderr: string }> {
  const scale = `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const fpsF = `fps=${o.fps}`;
  const chain = [scale, fpsF, ...STYLE_VF[o.style]].join(",");

  if (o.format === "gif") {
    const r = await runFfmpeg([
      "-i", o.input,
      "-vf", `${chain},split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
      "-loop", "0", o.out,
    ], 300_000);
    return r;
  }

  const hasAudio = !!(o.narrationWav || o.musicWav);
  const args: string[] = ["-i", o.input];
  if (o.narrationWav) args.push("-i", o.narrationWav);
  if (o.musicWav) args.push("-i", o.musicWav);

  if (!hasAudio) {
    args.push("-vf", chain, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  } else {
    // خلط: التعليق (صوت واضح) + الموسيقى (مستوى منخفض) مع تطبيع الطول
    const filterV = `[0:v]${chain}[v]`;
    let idx = 1;
    const parts: string[] = [];
    const ins: string[] = [];
    if (o.narrationWav) {
      parts.push(`[${idx}:a]volume=${o.narrationVolume ?? 1.0}[na]`);
      ins.push("[na]");
      idx++;
    }
    if (o.musicWav) {
      parts.push(`[${idx}:a]volume=${o.musicVolume ?? 0.35}[ma]`);
      ins.push("[ma]");
    }
    const mixFilter =
      ins.length === 2
        ? `${ins[0]}${ins[1]}amix=inputs=2:duration=longest:dropout_transition=2[aout]`
        : `${ins[0]}apad=whole_dur=${Math.max(1, o.durationSec ?? 5)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`;
    args.push(
      "-filter_complex", [filterV, ...parts, mixFilter].join(";"),
      "-map", "[v]", "-map", "[aout]",
      "-t", String(o.durationSec ?? 0),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
    );
  }
  args.push(o.out);
  return runFfmpeg(args, 420_000);
}

/** استخراج الإطار الأول كملصق (للطباعة) */
export async function extractPoster(input: string, outJpg: string): Promise<boolean> {
  const r = await runFfmpeg(["-i", input, "-vframes", "1", "-q:v", "3", outJpg], 60_000);
  return r.ok;
}

/** معلومات فيديو سريعة عبر ffprobe */
export function probeVideo(p: string): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration", "-show_entries", "format=duration",
      "-of", "json", p,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout?.on("data", (d) => (out += String(d)));
    proc.on("close", () => {
      try {
        const j = JSON.parse(out);
        const st = j?.streams?.[0] ?? {};
        const dur = Number(j?.format?.duration ?? st.duration ?? 0);
        resolve({ duration: dur, width: Number(st.width ?? 0), height: Number(st.height ?? 0) });
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}
