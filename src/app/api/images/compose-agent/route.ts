import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask } from "@/lib/task-store";
import { resolveFilePath, dataRootSync } from "@/lib/security/resolve-file-path";

const DATA_ROOT = dataRootSync();
const R = path.join(DATA_ROOT, "results");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZES = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"];

/**
 * POST /api/images/compose-agent — وكيل «إضافة محتوى إلى الصورة»
 *
 * يجمع شخصين من صورتين (مصدر + مرجع) في صورة واحدة حسب طلب المستخدم
 * (مثال: حفل زفاف بملابس الزفاف والمرأة بشعر أسود طويل ناعم) مع المحافظة
 * على ملامح الوجه الحقيقية للشخصين.
 *
 * ثلاث مراحل كما في تصور الوكيل الذكي:
 *   1. فهم   (understand)  — استقبال الطلب وتنظيفه
 *   2. تحليل (analyze)     — نموذج LLM يحلل الطلب ويحوّله إلى وصف إنجليزي
 *                            تفصيلي + يختار المقاس الأنسب (إن لم يحدده المستخدم)
 *   3. تطبيق (apply)       — نموذج تعديل الصور يستقبل الصورتين معًا ويبني
 *                            المشهد. في حال الرفض يُستخدم سقوط احتياطي:
 *                            دمج الصورتين جنبًا إلى جنب ثم تعديل بصورة واحدة.
 *
 * وضعان:
 *   - compose: sourcePath + referencePath  (الدمج الأول)
 *   - edit:    resultPath                  (تعديل تتابعي على آخر نتيجة:
 *              "على أي منظر أو وضعية تُطلب تُبنى الصورة")
 *
 * الرد: task-based — { taskId } ثم poll /api/task/status?id=
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const instruction: string = (body.instruction ?? "").toString().trim();
  if (!instruction) return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  if (instruction.length > 2000) return NextResponse.json({ error: "Instruction too long" }, { status: 400 });

  const hasPair = !!body.sourcePath && !!body.referencePath;
  const hasResult = !!body.resultPath;
  if (!hasPair && !hasResult) {
    return NextResponse.json({ error: "Provide sourcePath+referencePath or resultPath" }, { status: 400 });
  }

  try {
    if (body.sourcePath) body.sourcePath = await resolveFilePath(body.sourcePath);
    if (body.referencePath) body.referencePath = await resolveFilePath(body.referencePath);
    if (body.resultPath) body.resultPath = await resolveFilePath(body.resultPath);
  } catch {
    return NextResponse.json({ error: "Image file not found" }, { status: 404 });
  }

  const userSize: string | null = SIZES.includes(body.size) ? body.size : null;
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Compose Agent");
  // fire-and-forget runner (same pattern as every other image API here)
  (async () => {
    try {
      const Z = (await import("z-ai-web-dev-sdk")).default;
      const zai = await Z.create();

      // ---------- المرحلة 1: فهم ----------
      updateTask(taskId, { status: "processing", progress: 5, phase: "understand" });

      const mode = hasPair ? "compose" : "edit";

      // ---------- المرحلة 2: تحليل ----------
      updateTask(taskId, { progress: 15, phase: "analyze" });

      const sys = [
        "You are an expert AI photo-composition director working inside an image editing pipeline.",
        mode === "compose"
          ? "You will receive a request (any language, likely Arabic) asking to combine TWO different people from TWO provided photos into ONE realistic photo of a described scene (e.g. their wedding, a party, travel...)."
          : "You will receive a request (any language, likely Arabic) asking to CHANGE the scene/pose/outfit in an existing edited photo that already contains the same two people.",
        "Your job: output ONLY valid JSON (no markdown, no commentary) with keys:",
        '  "prompt": a detailed ENGLISH instruction for an image-editing model,',
        '  "size": one of "1024x1024","768x1344","864x1152","1344x768","1152x864","1440x720","720x1440"',
        "Rules for the prompt:",
        "- ALWAYS start with 'Ultra realistic professional photograph'.",
        mode === "compose"
          ? "- Refer to the two people as 'the first person' (first/primary image) and 'the second person' (second/reference image)."
          : "- Refer to the people already present in the photo; never replace or restyle their faces.",
        "- ALWAYS include: 'keep the exact same face, facial features and identity of both people unchanged, photorealistic, natural skin texture'.",
        "- Translate every user detail into the prompt (clothing, hair — e.g. 'long smooth black hair for the woman', background, pose, lighting, mood).",
        "- Add composition details: framing, camera angle, depth of field, warm natural lighting.",
        "- Never mention 'image 1 left/right side-by-side' — the final result is ONE scene containing both people together.",
        "- Keep it under 120 words.",
        "Rules for size:",
        userSize
          ? `- The user explicitly chose size ${userSize} → always use "${userSize}".`
          : "- Choose the closest aspect ratio for the described scene (wedding/landscape → 1344x768 or 1152x864, portrait → 768x1344 or 864x1152, square → 1024x1024).",
      ].join("\n");

      let prompt = "";
      let size = userSize ?? "1344x768";
      try {
        const cr = await zai.chat.completions.create({
          messages: [
            { role: "assistant", content: sys },
            { role: "user", content: `User request: "${instruction}"\nOutput the JSON now.` },
          ],
          thinking: { type: "disabled" },
        });
        const raw = cr?.choices?.[0]?.message?.content?.toString?.() ?? "";
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const j = JSON.parse(m[0]);
          if (typeof j.prompt === "string" && j.prompt.trim()) prompt = j.prompt.trim().slice(0, 900);
          if (typeof j.size === "string" && SIZES.includes(j.size) && !userSize) size = j.size;
        }
      } catch {
        /* LLM failure → fall through to a direct prompt */
      }
      if (!prompt) {
        prompt = `Ultra realistic professional photograph. ${instruction}. Keep the exact same face, facial features and identity of both people unchanged, photorealistic, natural skin texture, warm natural lighting, professional composition.`.slice(0, 900);
      }

      // ---------- المرحلة 3: تطبيق ----------
      updateTask(taskId, { progress: 35, phase: "apply", meta: { mode, size, prompt } });

      const asDataUrl = async (p: string): Promise<string> => {
        // خفض الأبعاد إلى ≤1024px قبل الترميز: يمنع انفجار الذاكرة (OOM على صندوق 4GB)
        // ويقصّر زمن الرفع — محرك التعديل يعمل بدقة ~1024 على أي حال.
        const buf = await sharp(p)
          .rotate()
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      };

      const buildPrompt = (m: "compose" | "edit") =>
        m === "compose"
          ? `${prompt}\n- The two people come from the two provided photos; place BOTH of them together in the SAME scene.\n- Preserve both faces exactly, match lighting and perspective, seamless natural result, no borders, no collage.`
          : `${prompt}\n- Edit this existing photo of the two people; keep both faces exactly identical, seamless natural result.`;

      const isCF = (e: unknown): boolean => {
        const m = e instanceof Error ? e.message : String(e);
        return m.includes("1301") || m.includes("contentFilter") || m.includes("不安全") || m.includes("敏感内容");
      };

      const is429 = (e: unknown): boolean => {
        const m = e instanceof Error ? e.message : String(e);
        return m.includes("429") || m.toLowerCase().includes("too many requests") || m.includes("请求过快");
      };

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      /**
       * استدعاء محرك تعديل الصور مع إعادة محاولة تلقائية عند حد المعدل (429):
       * حتى 4 محاولات بفواصل تصاعدية 15/30/45 ثانية — العميل يتابع حتى 8 دقائق
       * لذا لا تتخطى إعادة المحاولات مهلة المتابعة.
       */
      const callEdit = async (images: { url: string }[], p: string) => {
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            return await (zai.images.generations.edit as any)({ prompt: p, images, size });
          } catch (e) {
            lastErr = e;
            if (!is429(e) || attempt === 3) throw e;
            updateTask(taskId, { progress: Math.min(60, 40 + attempt * 5), phase: "apply", meta: { mode, size, retry429: attempt + 1 } });
            await sleep(15000 * (attempt + 1));
          }
        }
        throw lastErr;
      };

      let er: any = null;
      let usedMethod = "";

      if (mode === "compose") {
        // مسار 1: تمرير الصورتين معًا (يدعمه المحرك)
        try {
          const [u1, u2] = await Promise.all([asDataUrl(body.sourcePath), asDataUrl(body.referencePath)]);
          er = await callEdit([{ url: u1 }, { url: u2 }], buildPrompt("compose"));
          usedMethod = "multi-image-compose";
        } catch (e) {
          if (!isCF(e)) {
            await logEvent({ category: "tryon", level: "warn", message: "compose-agent multi-image failed, falling back to composite", details: e instanceof Error ? e.message : String(e) });
          }
          er = null;
        }

        // مسار 2 (سقوط احتياطي): دمج جنبًا إلى جنب ثم تعديل صورة واحدة
        if (!er?.data?.[0]?.base64) {
          updateTask(taskId, { progress: 50, phase: "apply", meta: { mode, size, fallback: "side-by-side" } });
          const H = 1024;
          const a = sharp(await fs.readFile(body.sourcePath)).rotate().resize({ height: H, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } });
          const b = sharp(await fs.readFile(body.referencePath)).rotate().resize({ height: H, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } });
          const [ba, bb] = await Promise.all([a.png().toBuffer(), b.png().toBuffer()]);
          const [ma, mb] = await Promise.all([sharp(ba).metadata(), sharp(bb).metadata()]);
          const canvas = sharp({
            create: { width: (ma.width ?? 512) + (mb.width ?? 512), height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
          });
          const combined = await canvas
            .composite([
              { input: ba, left: 0, top: 0 },
              { input: bb, left: ma.width ?? 512, top: 0 },
            ])
            .png()
            .toBuffer();
          const combinedUrl = `data:image/png;base64,${combined.toString("base64")}`;
          const p =
            `${prompt}\n- This reference sheet shows two different people side by side (left person and right person). ` +
            `Create ONE realistic photo containing BOTH people together in the described scene — not a side-by-side collage.\n` +
            `- Preserve each person's exact face and identity from the sheet.`;
          er = await callEdit([{ url: combinedUrl }], p);
          usedMethod = "side-by-side-compose";
        }
      } else {
        // وضع التعديل التتابعي على آخر نتيجة
        const url = await asDataUrl(body.resultPath);
        try {
          er = await callEdit([{ url }], buildPrompt("edit"));
          usedMethod = "result-edit";
        } catch (e) {
          if (!isCF(e)) throw e;
          er = null;
        }
      }

      // إعادة صياغة آمنة عند فلتر المحتوى
      if (!er?.data?.[0]?.base64) {
        updateTask(taskId, { progress: 60, phase: "apply", meta: { mode, size, retry: "safety-reword" } });
        try {
          const cr = await zai.chat.completions.create({
            messages: [
              { role: "assistant", content: "Reword image-edit instructions for a strict safety filter. Replace woman/man/girl/boy with 'person', remove words about face, age, body, skin, attractiveness. Keep the scene meaning. Output ONLY the reworded instruction." },
              { role: "user", content: prompt },
            ],
            thinking: { type: "disabled" },
          });
          const pp = cr?.choices?.[0]?.message?.content?.toString?.()?.trim?.() ?? "";
          if (pp) {
            const imgs =
              mode === "compose"
                ? [{ url: await asDataUrl(body.sourcePath) }, { url: await asDataUrl(body.referencePath) }]
                : [{ url: await asDataUrl(body.resultPath) }];
            er = await callEdit(imgs, `Apply this edit: ${pp}. Preserve identity of the people. No seams, no borders.`);
            usedMethod = "safety-reworded";
          }
        } catch {
          /* ignore → handled below */
        }
      }

      const b64 = er?.data?.[0]?.base64;
      if (!b64) {
        updateTask(taskId, { status: "error", error: "تعذر توليد الصورة — جرّب صياغة أبسط للطلب" });
        return;
      }

      // ---------- إنهاء ----------
      updateTask(taskId, { progress: 88, phase: "finalizing" });
      let buf: Buffer = Buffer.from(b64, "base64");
      const om = await sharp(buf).metadata();
      if (!om.width || !om.height) {
        updateTask(taskId, { status: "error", error: "ناتج غير صالح من محرك الصور" });
        return;
      }
      const n = `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const op = path.join(R, n);
      await fs.writeFile(op, buf);

      updateTask(taskId, {
        status: "done",
        progress: 100,
        phase: "done",
        result: {
          url: `/results/${n}`,
          path: op,
          width: om.width,
          height: om.height,
          size: buf.length,
          method: usedMethod,
          prompt,
          size,
        },
      });
    } catch (e) {
      updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : "Unknown error" });
    }
  })();

  return NextResponse.json({ taskId, status: "pending", message: `Poll /api/task/status?id=${taskId}` });
}
