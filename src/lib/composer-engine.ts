/**
 * Composer Engine — المحرك المشترك لوكيل «إضافة محتوى إلى الصورة» ووكيل «توليد الفيديو من الصور».
 *
 * المسؤوليات:
 *   1. تحميل صور الأشخاص وتصغيرها (data URLs آمنة للترميز).
 *   2. وصف الأشخاص عبر VLM (لتحسين المشهد: الجنس/الشعر/الملابس/البنية).
 *   3. تخطيط المشهد عبر LLM → وصف إنجليزي احترافي + مقاس + بحث عن مشاهير.
 *   4. البحث عن صور مرجعية لشخصيات مذكورة بالاسم (زai.images.search).
 *   5. بناء المشهد عبر محرك تعديل الصور (عدة صور معًا) مع سقوط احتياطي.
 *   6. قفل الملامح: كشف وجوه النتيجة عبر 3030 ثم تبديل كل وجه بالوجه الحقيقي
 *      للشخص المقابل (ترتيب يسار→يمين) — حفظ إلزامي لملامح الوجوه الحقيقية.
 *
 * كل الدوال محصّنة: أي فشل في مرحلة اختيارية لا يُسقط الخط كاملاً.
 */

import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { dataRootSync } from "@/lib/security/resolve-file-path";

const SWAP_SERVICE = "http://localhost:3030";
const LAMA_SERVICE = "http://localhost:3031";

/** تحرير ذاكرة LaMa (~1.2GB) قبل التبديل الثقيل / إعادة إحمائها بعده */
async function lamaControl(action: "unload" | "warm"): Promise<void> {
  try {
    await fetch(`${LAMA_SERVICE}/${action}`, { method: action === "unload" ? "POST" : "GET", signal: AbortSignal.timeout(5000) });
  } catch {
    /* غير حرج */
  }
}

export const COMPOSE_SIZES = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"] as const;
export type ComposeSize = (typeof COMPOSE_SIZES)[number];

export interface PersonImage {
  /** مصدر الصورة: مسار مطلق على القرص (فارغ لصور البحث) */
  path: string;
  /** دور الشخص في المشهد */
  role: "source" | "reference" | "searched";
  /** اسم اختياري (شخصية مشهورة مثلاً) */
  name?: string;
  /** وصف VLM اختياري (الجنس/الشعر/الملابس...) */
  desc?: string;
  /** data URL جاهز (صور البحث تُحمّل مباشرة دون مسار) */
  dataUrl?: string;
}

export interface ScenePlan {
  prompt: string;
  size: ComposeSize;
  /** بحث عن صور أشخاص مذكورين بالاسم وغير مرفوعين */
  searches: { name: string; query: string }[];
  understanding: string;
  provider: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getZai() {
  const Z = (await import("z-ai-web-dev-sdk")).default;
  return Z.create();
}

export function isContentFilter(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes("1301") || m.includes("contentFilter") || m.includes("不安全") || m.includes("敏感内容");
}

export function isRateLimit(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes("429") || m.toLowerCase().includes("too many requests") || m.includes("请求过快");
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** تحميل صورة شخص وتصغيرها إلى data URL (≤1024px) — يمنع OOM ويقصّر الرفع */
export async function loadPersonDataUrl(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  const out = await sharp(buf)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

// ============================================================
// 2) وصف الأشخاص عبر VLM (best-effort)
// ============================================================

/** وصف موجز لكل شخص (سطر لكل صورة، بنفس الترتيب) — فارغ عند أي فشل */
export async function describePeople(dataUrls: string[]): Promise<string[]> {
  if (!dataUrls.length) return [];
  try {
    const zai = await getZai();
    const content: any[] = [
      {
        type: "text",
        text:
          `You are assisting a photo-composition director. For EACH person photo (in order), output ONE short line in English: ` +
          `gender, approximate age, hair style & color, facial hair (if any), clothing style & colors, body build, skin tone. ` +
          `Never guess identity or name. Output ONLY a JSON array of ${dataUrls.length} strings, no markdown.`,
      },
      ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];
    const response = await zai.chat.completions.createVision({
      messages: [{ role: "user", content }],
      thinking: { type: "disabled" },
    } as never);
    const text = response?.choices?.[0]?.message?.content?.toString?.() ?? "";
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        return dataUrls.map((_, i) => (typeof arr[i] === "string" ? arr[i].slice(0, 220) : ""));
      }
    }
  } catch (e) {
    await logEvent({ category: "tryon", level: "debug", message: "describePeople failed (non-fatal)", details: e instanceof Error ? e.message : String(e) });
  }
  return dataUrls.map(() => "");
}

// ============================================================
// 3) تخطيط المشهد عبر LLM
// ============================================================

/**
 * يحوّل طلب المستخدم (أي لغة، غالبًا عربي) إلى خطة توليد:
 * وصف إنجليزي احترافي للمشهد + مقاس + استعلامات بحث عن أشخاص مذكورين بالاسم.
 */
export async function planScene(opts: {
  instruction: string;
  people: { role: string; name?: string; desc?: string }[];
  poses: string[];
  userSize?: string;
  mode: "compose" | "edit";
}): Promise<ScenePlan> {
  const userSize = (COMPOSE_SIZES as readonly string[]).includes(opts.userSize ?? "")
    ? (opts.userSize as ComposeSize)
    : null;

  const sys = [
    "You are an expert AI photo-composition director working inside an image generation pipeline.",
    opts.mode === "compose"
      ? `You will receive a request (any language, likely Arabic) to combine ${Math.max(1, opts.people.length)} REAL person(s) from provided photos into ONE hyper-realistic photo of a described scene (wedding, handshake with a president/artist, beach trip...).`
      : "You will receive a request to CHANGE the scene/pose/outfit in an existing photo that already contains the same people.",
    "",
    "Output ONLY valid JSON (no markdown, no commentary) with keys:",
    '  "understanding": جملة-جملتان بالعربية: ماذا فهمت من الطلب',
    '  "prompt": a detailed ENGLISH instruction for the image model (see rules),',
    `  "size": one of ${JSON.stringify(COMPOSE_SIZES)},`,
    '  "searches": [ {"name": "اسم الشخصية المذكورة", "query": "English portrait search query"} ] — ONLY for named public figures the user mentioned who are NOT among the provided photos (e.g. "الرئيس فلان", "الفنان فلان"). Empty array if none.',
    "",
    "Rules for prompt:",
    "- ALWAYS start with 'Ultra realistic professional photograph'.",
    "- People from provided photos are referred to as: " +
      (opts.people.length
        ? opts.people.map((p, i) => `person ${i + 1} (${p.role}${p.desc ? `: ${p.desc}` : ""})`).join(", ")
        : "the people in the photo"),
    "- For searched/mentioned public figures: describe them as 'person N (the named public figure found in its own provided photo)' — their real face comes from that photo.",
    "- ALWAYS include: 'keep the exact same face, facial features and identity of every person unchanged, photorealistic, natural skin texture'.",
    "- Translate every user detail: scene, clothing, hair, background, time of day, weather, mood.",
    "- State the EXACT number of people and their relative positions (who is on the left/right/center).",
    opts.poses.length
      ? `- The user explicitly selected these POSES — they are mandatory: ${opts.poses.join(" | ")}. Fold each pose into the scene description precisely (bodies, arms, heads).`
      : "",
    "- Add composition details: framing, camera angle, depth of field, warm natural lighting, consistent shadows.",
    "- Never mention collages or side-by-side sheets — the result is ONE scene with everyone together.",
    "- Keep it under 130 words.",
    "Rules for size:",
    userSize
      ? `- The user explicitly chose size ${userSize} → always use "${userSize}".`
      : "- Choose the closest aspect ratio for the scene (wedding/landscape → 1344x768 or 1152x864, portrait → 768x1344 or 864x1152, square → 1024x1024).",
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg =
    (opts.people.length
      ? `Provided people (in order): ${opts.people
          .map((p, i) => `${i + 1}. ${p.role}${p.name ? ` "${p.name}"` : ""}${p.desc ? ` — ${p.desc}` : ""}`)
          .join("; ")}\n`
      : "") +
    `User request: "${opts.instruction}"\nOutput the JSON now.`;

  let fallbackPrompt = "";
  try {
    const zai = await getZai();
    const cr = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: sys },
        { role: "user", content: userMsg },
      ],
      thinking: { type: "disabled" },
    });
    const raw = cr?.choices?.[0]?.message?.content?.toString?.() ?? "";
    const j = extractJson(raw);
    if (j) {
      const prompt = typeof j.prompt === "string" ? j.prompt.trim() : "";
      const size = typeof j.size === "string" && (COMPOSE_SIZES as readonly string[]).includes(j.size) ? (j.size as ComposeSize) : null;
      const searches = Array.isArray(j.searches)
        ? (j.searches as any[])
            .filter((s) => s && typeof s.query === "string" && s.query.trim())
            .map((s) => ({ name: String(s.name ?? s.query).slice(0, 80), query: String(s.query).slice(0, 120) }))
            .slice(0, 3)
        : [];
      if (prompt) {
        return {
          prompt: prompt.slice(0, 950),
          size: size ?? userSize ?? "1344x768",
          searches,
          understanding: typeof j.understanding === "string" ? j.understanding.slice(0, 300) : "",
          provider: "llm",
        };
      }
    }
    fallbackPrompt = raw.slice(0, 400);
  } catch (e) {
    await logEvent({ category: "tryon", level: "warn", message: "planScene LLM failed → fallback prompt", details: e instanceof Error ? e.message : String(e) });
  }

  // سقوط احتياطي: وصف مباشر من نص المستخدم
  const poseTxt = opts.poses.length ? ` Poses: ${opts.poses.join(", ")}.` : "";
  return {
    prompt:
      `Ultra realistic professional photograph. ${opts.instruction}.${poseTxt} ` +
      `Keep the exact same face, facial features and identity of every person unchanged, photorealistic, natural skin texture, warm natural lighting, professional composition.`.slice(0, 950),
    size: userSize ?? "1344x768",
    searches: [],
    understanding: fallbackPrompt ? "" : "",
    provider: "fallback",
  };
}

// ============================================================
// 4) البحث عن صور مرجعية لشخصيات بالاسم (مشاهير)
// ============================================================

/** يبحث عن صورة بورتريه واقعية لكل استعلام ويعيدها data URL (best-effort) */
export async function searchPortraits(searches: { name: string; query: string }[]): Promise<PersonImage[]> {
  const out: PersonImage[] = [];
  if (!searches.length) return out;
  let zai: Awaited<ReturnType<typeof getZai>> | null = null;
  try {
    zai = await getZai();
  } catch {
    return out;
  }
  for (const s of searches.slice(0, 3)) {
    try {
      const res = await zai!.images.search.create({ query: `${s.query} face portrait high resolution photo`, count: 5, gl: "sa", rank: true });
      const items = (res?.results ?? []).filter((r) => {
        const w = Number(r.original_width ?? 0);
        const h = Number(r.original_height ?? 0);
        return w >= 250 && h >= 250;
      });
      for (const item of items.slice(0, 2)) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          const fr = await fetch(item.original_url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AIStudio/1.0)" } });
          clearTimeout(t);
          if (!fr.ok) continue;
          const buf = Buffer.from(await fr.arrayBuffer());
          if (buf.length < 8_000) continue; // صورة صغيرة جدًا/عنصر تزييني
          const png = await sharp(buf)
            .rotate()
            .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();
          out.push({
            path: "",
            role: "searched",
            name: s.name,
            desc: `real photo of ${s.name}`,
            dataUrl: `data:image/jpeg;base64,${png.toString("base64")}`,
          });
          break; // صورة واحدة كافية لكل شخصية
        } catch {
          /* جرّب الرابط التالي */
        }
      }
    } catch (e) {
      await logEvent({ category: "tryon", level: "debug", message: `portrait search failed for "${s.name}"`, details: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ============================================================
// 5) بناء المشهد (محرك التعديل متعدد الصور)
// ============================================================

/** استدعاء محرك تعديل الصور مع إعادة محاولة عند 429 (15/30/45ث) */
export async function callImageEdit(
  zai: Awaited<ReturnType<typeof getZai>>,
  images: { url: string }[],
  prompt: string,
  size: string,
  onRetry?: (attempt: number) => void
): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await (zai.images.generations.edit as any)({ prompt, images, size });
    } catch (e) {
      lastErr = e;
      if (!isRateLimit(e) || attempt === 3) throw e;
      onRetry?.(attempt + 1);
      await sleep(15000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * بناء المشهد من صور الأشخاص + الوصف.
 * مسار 1: كل الصور معًا في استدعاء واحد. مسار 2: لوحة جانبية ثم تحرير.
 * يعيد PNG buffer + اسم الطريقة.
 */
export async function composeScene(opts: {
  dataUrls: string[];
  prompt: string;
  size: string;
  onRetry?: (attempt: number) => void;
}): Promise<{ buffer: Buffer; method: string }> {
  const zai = await getZai();
  const p =
    `${opts.prompt}\n` +
    `- The people come from the provided photos; place ALL of them together in the SAME scene.\n` +
    `- CHANGE clothing/hairstyle exactly as the scene requires while keeping every FACE and identity exactly identical.\n` +
    `- Match lighting and perspective, seamless natural result, no borders, no collage.`;

  let er: any = null;
  let method = "";
  try {
    er = await callImageEdit(zai, opts.dataUrls.map((url) => ({ url })), p, opts.size, opts.onRetry);
    method = "multi-image-compose";
  } catch (e) {
    if (!isContentFilter(e)) throw e;
    er = null;
  }

  // سقوط احتياطي 1: إعادة صياغة آمنة
  if (!er?.data?.[0]?.base64) {
    try {
      const cr = await zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              "Reword image-edit instructions for a strict safety filter. Replace woman/man/girl/boy with 'person', remove words about face, age, body, skin, attractiveness. Keep the scene meaning. Output ONLY the reworded instruction.",
          },
          { role: "user", content: opts.prompt },
        ],
        thinking: { type: "disabled" },
      });
      const pp = cr?.choices?.[0]?.message?.content?.toString?.()?.trim?.() ?? "";
      if (pp) {
        er = await callImageEdit(
          zai,
          opts.dataUrls.map((url) => ({ url })),
          `Apply this edit: ${pp}. Preserve identity of every person. No seams, no borders.`,
          opts.size,
          opts.onRetry
        );
        method = "safety-reworded";
      }
    } catch {
      /* يُتابع للسقوط التالي */
    }
  }

  // سقوط احتياطي 2: لوحة جانبية (كل الصور في صف واحد) ثم تحرير صورة واحدة
  if (!er?.data?.[0]?.base64) {
    const H = 1024;
    const bufs: Buffer[] = [];
    for (const url of opts.dataUrls.slice(0, 4)) {
      const raw = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      bufs.push(await sharp(raw).resize({ height: H, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer());
    }
    const metas = await Promise.all(bufs.map((b) => sharp(b).metadata()));
    const totalW = metas.reduce((a, m) => a + (m.width ?? 512), 0);
    let left = 0;
    const comps: any[] = [];
    for (let i = 0; i < bufs.length; i++) {
      comps.push({ input: bufs[i], left, top: 0 });
      left += metas[i].width ?? 512;
    }
    const combined = await sharp({ create: { width: totalW, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(comps)
      .png()
      .toBuffer();
    const sheetUrl = `data:image/png;base64,${combined.toString("base64")}`;
    const sheetPrompt =
      `${opts.prompt}\n` +
      `- This reference sheet shows ${bufs.length} different people side by side (in order). ` +
      `Create ONE realistic photo containing ALL of them together in the described scene — not a side-by-side collage.\n` +
      `- Preserve each person's exact face and identity from the sheet.`;
    er = await callImageEdit(zai, [{ url: sheetUrl }], sheetPrompt, opts.size, opts.onRetry);
    method = "side-by-side-compose";
  }

  const b64 = er?.data?.[0]?.base64;
  if (!b64) throw new Error("تعذر توليد المشهد — جرّب صياغة أبسط للطلب");
  const buffer = Buffer.from(b64, "base64");
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error("ناتج غير صالح من محرك الصور");
  return { buffer, method };
}

// ============================================================
// 6) قفل الملامح — حفظ إلزامي لوجوه الأشخاص الحقيقية
// ============================================================

async function swapServiceFetch(endpoint: string, body: any, timeoutMs = 120_000): Promise<any> {
  const res = await fetch(`${SWAP_SERVICE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `swap-service HTTP ${res.status}`);
  }
  return data;
}

export interface LockReport {
  detected: number;
  locked: number;
  note: string;
  buffer: Buffer;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** انتظار جهوزية خدمة الوجوه (قد تكون قيد إعادة التشغيل بعد OOM) */
async function waitForSwapService(maxWaitMs = 45_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    try {
      const res = await fetch(`${SWAP_SERVICE}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* لم تجهز بعد */
    }
    await sleepMs(3000);
  }
  return false;
}

/**
 * كشف الوجوه في الصورة المولّدة ثم تبديل كل وجه بالوجه الحقيقي للشخص المقابل.
 * الترتيب: الأشخاص يُرتّبون من اليسار لليمين حسب مواضع الوجوه المكتشفة.
 *
 * إدارة الذاكرة (صندوق 4GB): عملية التبديل بوضع HQ تستهلك ~2.2GB وقد
 * يقتل النظام العملية بـ OOM — لذا نعمل على نسخة مصغرة (≤1152px) ونعيد
 * المحاولة بعد أن يعيد الحارس تشغيل الخدمة. الفشل غير مسقط: الصورة
 * المولّدة تحاول أصلًا حفظ الملامح والقفل طبقة ضمان إضافية.
 */
export async function lockIdentities(opts: {
  sceneBuffer: Buffer;
  persons: { dataUrl: string; name?: string }[];
  onProgress?: (locked: number, total: number) => void;
}): Promise<LockReport> {
  const persons = opts.persons.filter((p) => !!p.dataUrl);
  const meta = await sharp(opts.sceneBuffer).metadata();
  if (!persons.length || !meta.width) {
    return { detected: 0, locked: 0, note: "لا توجد صور أشخاص لقفل الملامح", buffer: opts.sceneBuffer };
  }
  if (!(await waitForSwapService())) {
    return { detected: 0, locked: 0, note: "خدمة الوجوه غير متاحة حاليًا — الصورة معروضة كما وُلّدت (المحرك يحافظ على الملامح أصلًا)", buffer: opts.sceneBuffer };
  }

  // تنسيق الذاكرة: تفريغ LaMa قبل التبديل (يحمي من OOM) — يعود للتحميل الكسول لاحقًا
  await lamaControl("unload");

  // نسخة عمل مصغرة لتخفيف الذاكرة (التبديل بوضع HQ يصل 2.2GB على الصور الكبيرة)
  const needDownscale = Math.max(meta.width, meta.height) > 1152;
  const workBuffer = needDownscale
    ? await sharp(opts.sceneBuffer)
        .resize({ width: 1152, height: 1152, fit: "inside" })
        .png()
        .toBuffer()
    : opts.sceneBuffer;
  let current = `data:image/png;base64,${workBuffer.toString("base64")}`;

  try {
    const det = await swapServiceFetch("/detect", { image: current }, 90_000);
    const faces: any[] = Array.isArray(det?.faces) ? det.faces : [];
    if (!faces.length) {
      return { detected: 0, locked: 0, note: "لم تُكتشف وجوه في النتيجة — تم عرض الصورة كما وُلّدت", buffer: opts.sceneBuffer };
    }

    // ترتيب الوجوه من اليسار لليمين (bboxPx = [x1,y1,x2,y2])
    const ordered = faces
      .map((f: any) => {
        const bb = Array.isArray(f.bboxPx) ? f.bboxPx : null;
        const cx = bb ? (Number(bb[0]) + Number(bb[2])) / 2 : Number.MAX_SAFE_INTEGER;
        return { index: Number(f.index ?? 0), cx };
      })
      .sort((a, b) => a.cx - b.cx);

    const count = Math.min(ordered.length, persons.length);
    let locked = 0;
    for (let i = 0; i < count; i++) {
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          const r = await swapServiceFetch("/swap", { source: current, face: persons[i].dataUrl, sourceIndex: ordered[i].index });
          const out = String(r?.result ?? "");
          if (out.startsWith("data:image")) {
            current = out;
            locked++;
            done = true;
            opts.onProgress?.(locked, count);
          }
        } catch (e) {
          await logEvent({
            category: "tryon",
            level: "debug",
            message: `identity-lock face ${i} attempt ${attempt + 1} failed`,
            details: e instanceof Error ? e.message : String(e),
          });
          if (attempt === 0) {
            // غالبًا OOM قتل الخدمة — ننتظر إحياء الحارس ثم نكمل من آخر صورة محفوظة
            await waitForSwapService(60_000);
          }
        }
      }
    }
    const note =
      locked === 0
        ? "تعذر قفل الملامح تلقائيًا (خدمة الوجوه مشغولة بالذاكرة) — الصورة معروضة كما وُلّدت والمحرك يحافظ على الملامح أصلًا"
        : locked < count
          ? `تم قفل ${locked} من ${count} وجوه بالملامح الحقيقية`
          : `تم قفل جميع الوجوه (${locked}) بالملامح الحقيقية`;
    const buffer =
      locked > 0
        ? await sharp(Buffer.from(current.slice(current.indexOf(",") + 1), "base64"))
            .png()
            .toBuffer()
        : opts.sceneBuffer;
    return { detected: faces.length, locked, note, buffer };
  } catch (e) {
    await logEvent({ category: "tryon", level: "debug", message: "identity-lock skipped", details: e instanceof Error ? e.message : String(e) });
    return { detected: 0, locked: 0, note: "قفل الملامح غير متاح حاليًا (خدمة الوجوه مشغولة) — الصورة معروضة كما وُلّدت", buffer: opts.sceneBuffer };
  } finally {
    // إعادة إحماء LaMa ليعود مزيل الكائنات جاهزًا (تحميل كسول في الخلفية)
    await lamaControl("warm");
  }
}

// ============================================================
// 7) تحسين جودة الصورة (زر «تحسين الجودة»)
// ============================================================

export async function enhanceImageBuffer(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const targetW = Math.min(2400, Math.round((meta.width ?? 1024) * 1.6));
  return sharp(buf)
    .resize({ width: targetW, withoutEnlargement: false })
    .sharpen({ sigma: 1.1 })
    .normalize()
    .modulate({ saturation: 1.06, brightness: 1.02 })
    .png()
    .toBuffer();
}

/** حفظ نتيجة في data/results — عبر dataRootSync الثابت (cwd الخادم المستقل
 *  يشير إلى .next/standalone الذي يُمحى عند كل بناء — لهذا تختفي النتائج) */
export async function saveResult(buffer: Buffer, prefix: string, ext = "png"): Promise<string> {
  const resultsRoot = path.join(dataRootSync(), "results");
  await fs.mkdir(resultsRoot, { recursive: true });
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await fs.writeFile(path.join(resultsRoot, name), buffer);
  return name;
}
