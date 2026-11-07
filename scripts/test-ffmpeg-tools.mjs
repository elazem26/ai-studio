/* اختبار سريع لأدوات ffmpeg: موسيقى + تغليف فيديو سينمائي + فحص */
import { spawn } from "child_process";
import { promises as fs, statSync } from "fs";
import path from "path";

const TMP = "/home/z/my-project/data/temp";
const run = (args) =>
  new Promise((res) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => res({ ok: c === 0, err: err.slice(-300) }));
  });

async function main() {
  await fs.mkdir(TMP, { recursive: true });
  // فيديو اختبار 3 ثوانٍ من مصدر اصطناعي
  const raw = path.join(TMP, "t-raw.mp4");
  const r1 = await run(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", raw]);
  console.log("raw:", r1.ok, r1.err);

  // موسيقى هادئة 4 ثوانٍ
  const music = path.join(TMP, "t-music.wav");
  const expr = "(0.055*sin(2*PI*196*t)+0.05*sin(2*PI*293.66*t)+0.045*sin(2*PI*369.99*t))*(0.75+0.25*sin(2*PI*0.12*t))*(0.7+0.3*sin(2*PI*0.05*t+1.3))";
  const r2 = await run(["-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=4`, "-af", "lowpass=f=1200,aformat=sample_fmts=fltp:channel_layouts=stereo", "-c:a", "pcm_s16le", music]);
  console.log("music:", r2.ok, r2.err);

  // موسيقى مبهجة (التعبير مقتبس بعلامات '...' لحماية الفاصلة في mod(t,0.5))
  const music2 = path.join(TMP, "t-music2.wav");
  const beat = "(1-exp(-12*mod(t,0.5)))";
  const expr2 = "(0.09*sin(2*PI*220*t)*" + beat + "+0.07*sin(2*PI*330*t)*" + beat + "+0.05*sin(2*PI*440*t)*" + beat + ")";
  const r2b = await run(["-f", "lavfi", "-i", `aevalsrc='${expr2}':s=44100:d=4`, "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.012:duration=4", "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.4[m];[m]lowpass=f=4000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]", "-map", "[a]", "-c:a", "pcm_s16le", music2]);
  console.log("music2:", r2b.ok, r2b.err);

  // تغليف سينمائي مع صوت (موسيقى فقط)
  const out = path.join(TMP, "t-out.mp4");
  const chain = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,colorbalance=rs=-0.04:bs=0.07,eq=contrast=1.07:saturation=1.04:brightness=-0.01,vignette=PI/5";
  const r3 = await run([
    "-i", raw, "-i", music,
    "-filter_complex", `[0:v]${chain}[v];[1:a]volume=0.35[ma];[ma]apad=whole_dur=3,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`,
    "-map", "[v]", "-map", "[aout]", "-t", "3",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
  ]);
  console.log("package:", r3.ok, r3.err);

  // فحص الناتج
  const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height", "-of", "json", out]);
  let po = "";
  probe.stdout.on("data", (d) => (po += d));
  probe.on("close", () => {
    const j = JSON.parse(po);
    console.log("probe:", JSON.stringify(j.streams?.map((s) => s.codec_type)), "dur:", j.format?.duration);
    console.log("sizeKB:", (statSync(out).size / 1024).toFixed(0));
  });
}
main();
