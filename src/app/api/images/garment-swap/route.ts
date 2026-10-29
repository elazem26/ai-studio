import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { readForDetect } from "@/lib/detect-image";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";
import {
  createSwapJob, getSwapJob, updateSwapStage, finishSwapJob, failSwapJob,
} from "@/lib/garment-swap-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";

type PersonBox = { index: number; bbox: [number, number, number, number]; faceBbox?: [number, number, number, number] };

/* ============================================================================
 * GARMENT SWAP — نفس نظام تبديل الملابس القديم العامل (cloud-ai-adapter)
 * ============================================================
 * المستخدم أكّد: "النظام القديم قبل التعديل كان يعمل بشكل جيد — المطلوب
 * فقط إضافة المربعات المرقمة دون تغيير نظام تبديل الملابس".
 *
 * لذلك هذا المسار يطبّق حرفياً نفس خط cloud-ai-adapter ("Real Try-On v2")
 * الذي كان يعمل في الاستوديو قبل المربعات، بنفس الخطوات وبنفس النصوص:
 *   1. استخراج القطعة وحدها على خلفية بيضاء (extractGarmentOnWhite)
 *   2. وصف VLM دقيق للقطعة + تعقيم (نفس قوائم الكلمات الحساسة)
 *   3. تعديل الصورة كاملة: images=[المصدر، القطعة على الأبيض] بحجم
 *      مطابق لنسبة أبعاد المصدر (pickBestSize)
 *   4. تحقق VLM على المحاولتين الأولى والثانية (oldOutfitVisible فقط —
 *      مع فحص تطابق النصف السفلي من الطقم) — المحاولة الأخيرة تُحفظ دائماً
 *   5. الناتج يُحفظ كما هو — لا لصق ولا أقنعة ولا مركّبات إطلاقاً
 *
 * التكييف الوحيد اللازم لعمل المربعات المرقمة (بدون تغيير النظام):
 *   - بند TARGET PERSON نصي يحدد الشخص الهدف بموقعه عند تعدد الأشخاص
 *   - تعديلات متسلسلة عند تعدد الروابط (الربط الثاني يعدّل ناتج الأول)
 *   - غلاف المهمة غير المتزامنة (async job) — بروكسي المعاينة يقتل
 *     الاتصالات الطويلة، والواجهة تعتمد الاستقصاء.
 * ========================================================================== */

/** Same auto-start logic as the other image routes (shared service). */
async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${MINI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function spawnServiceIfDown(): Promise<boolean> {
  if (await isMiniServiceUp()) return true;
  try {
    const { spawn } = (typeof eval !== "undefined") ? eval("require")("child_process") : require("child_process");
    const proc = spawn("/home/z/.venv/bin/python3", [`${process.cwd()}/mini-services/face-swap-pro/server.py`], {
      cwd: process.cwd(), detached: true, stdio: "ignore", env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    proc.unref();
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isMiniServiceUp()) return true;
    }
    return false;
  } catch { return false; }
}

/** Detection uses a DOWNSCALED copy — coordinates are normalized so the
 *  boxes are identical, but the payload/decode is ~10-50x faster. */
async function detectPersons(absPath: string): Promise<PersonBox[]> {
  const dataUrl = await readForDetect(absPath);
  const res = await fetch(`${MINI_SERVICE_URL}/detect-persons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
    signal: AbortSignal.timeout(60_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || "person detection failed");
  return data.persons ?? [];
}

/* ---------------------------------------------------------------- helpers */

const SUPPORTED_SIZES_PORTRAIT = ["768x1344", "864x1152", "720x1440"];
const SUPPORTED_SIZES_LANDSCAPE = ["1344x768", "1152x864", "1440x720"];

/** Closest API-supported size to a width/height ratio (same as try-on). */
function pickBestSize(width: number, height: number): string {
  const sizes = height > width ? SUPPORTED_SIZES_PORTRAIT : SUPPORTED_SIZES_LANDSCAPE;
  const ratio = width / height;
  let best = sizes[0];
  let bestDiff = Infinity;
  for (const s of sizes) {
    const [w, h] = s.split("x").map(Number);
    const diff = Math.abs(w / h - ratio);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

/** Bound an image buffer for the edit API (auto-orient + proportional
 *  downscale — the aspect ratio NEVER changes). .rotate() is CRITICAL:
 *  detection runs on auto-oriented pixels, so coordinates only match an
 *  auto-oriented buffer (EXIF-rotated JPEGs). */
async function imageForEdit(buf: Buffer, maxDim: number): Promise<{ dataUrl: string; w: number; h: number }> {
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 768;
  const h = meta.height ?? 1024;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(16, Math.round(w * scale));
  const outH = Math.max(16, Math.round(h * scale));
  const out = scale < 1
    ? await sharp(buf, { failOn: "none" }).rotate().resize(outW, outH).jpeg({ quality: 92 }).toBuffer()
    : await sharp(buf, { failOn: "none" }).rotate().jpeg({ quality: 92 }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`, w: outW, h: outH };
}

/**
 * Extract ONLY the garment from a reference torso crop onto a pure white
 * background — identical to extractGarmentOnly in the working try-on
 * pipeline. Returns a data URL, or null.
 */
async function extractGarmentOnWhite(zai: any, torsoDataUrl: string): Promise<string | null> {
  try {
    const extractPrompt =
      "Professional product photography extraction.\n\n" +
      "Extract ONLY the clothing/garment from this image and place it flat on a pure white background (#FFFFFF).\n\n" +
      "RULES:\n" +
      "- Remove any person, model, mannequin, body parts, or background from the image\n" +
      "- Keep ONLY the garment itself — as if it were laid flat on a white surface for an e-commerce product photo\n" +
      "- If the garment is a matching set (top + bottom), extract BOTH pieces together on the white background\n" +
      "- Preserve the garment's exact color, fabric texture, pattern, buttons, zippers, collar, sleeves, and all details\n" +
      "- The output should be a clean flat-lay product photo with the garment centered on pure white\n" +
      "- No body parts, no shadows of a person, no model — JUST THE GARMENT\n\n" +
      "Output: a clean garment product photo on white background.";
    const response = await zai.images.generations.edit({
      prompt: extractPrompt,
      images: [{ url: torsoDataUrl }],
      size: "1024x1024",
    });
    const b64 = response?.data?.[0]?.base64;
    if (!b64 || b64.length < 1000) return null;
    return `data:image/png;base64,${b64}`;
  } catch (e) {
    console.warn("[garment-swap] garment extraction failed:", e);
    return null;
  }
}

/** VLM describes the garment with extreme precision (same as try-on). */
async function describeGarment(zai: any, garmentDataUrl: string): Promise<string> {
  try {
    const vlmResponse = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "You are a fashion product photographer and stylist. Describe the garment in this image with EXTREME PRECISION about its shape, design, and physical details — not just color.\n\n" +
                "CRITICAL RULES:\n" +
                "- Describe ONLY the clothing item itself\n" +
                "- DO NOT mention body, skin, hair, face, pose, gender, or any person attributes\n" +
                "- NEVER use the words lingerie, underwear, bikini, swimsuit, bra, or panties — describe such garments with NEUTRAL fashion terms instead (e.g., \"two-piece athletic set\", \"fitted top with matching shorts\", \"one-piece athletic set\")\n" +
                "- Be EXTREMELY specific about the SHAPE and STRUCTURE so another AI can replicate it EXACTLY\n\n" +
                "Format (be specific in each field):\n" +
                "1. TYPE + PIECES: [state whether this is ONE garment or a MULTI-PIECE SET, then list EVERY piece exactly — e.g., 'two-piece set: cropped athletic top + high-waisted shorts', 'one-piece dress', 'shirt + jeans'. The lower piece (shorts, pants, skirt, bottom) MUST be included if one is visible]\n" +
                "2. COLOR: [primary color + secondary color, with hex if possible]\n" +
                "3. FABRIC: [cotton, silk, denim, wool, leather, polyester, knit, linen, etc.]\n" +
                "4. COLLAR/NECKLINE: [round neck, V-neck, classic collar, hooded, turtleneck, off-shoulder, etc.]\n" +
                "5. SLEEVES: [sleeveless, cap, short, 3/4, long, with cuffs — specify length]\n" +
                "6. PATTERN: [solid, striped, plaid, checkered, floral, polka dot, geometric, color-block, etc.]\n" +
                "7. CLOSURE: [pullover, button-up, zipper, snap, tie, wrap, etc.]\n" +
                "8. POCKETS: [none, chest pocket, side pockets, flap pockets — count and position]\n" +
                "9. HEM/LENGTH: [cropped, regular, longline, tunic, asymmetrical, etc.]\n" +
                "10. FIT: [skinny, slim, regular, relaxed, oversized, tailored, etc.]\n" +
                "11. NOTABLE DETAILS: [embroidery, logo, contrast stitching, buttons color, etc.]\n" +
                "12. LOWER PIECE: [if a lower garment is visible (shorts, pants, skirt, or bottom piece), describe its exact color, fabric, length, waist height, and fit; if the reference only shows an upper garment, write 'none visible']\n\n" +
                "End with: REPLICATE THIS EXACT OUTFIT (EVERY piece, top and bottom): [one-sentence summary with ALL pieces and critical details]. English only.",
            },
            { type: "image_url", image_url: { url: garmentDataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    } as any);
    const text = vlmResponse?.choices?.[0]?.message?.content?.trim() ?? "";
    return text ? text.slice(0, 1500) : "";
  } catch (e) {
    console.warn("[garment-swap] garment VLM description failed:", e);
    return "";
  }
}

/* Same sensitive-word lists as the working try-on sanitizer, PLUS safe
 * replacements: banned garment words are swapped for neutral equivalents
 * BEFORE deletion so the LOWER piece of the outfit survives the sanitiser
 * (this was the root cause of "only the top gets swapped"). */
const SAFE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bbikini(\s+(top|bottom|set))?s?\b/gi, "two-piece athletic set"],
  [/\b(swimsuit|swimwear)s?\b/gi, "one-piece athletic set"],
  [/\b(bra|bralette)s?\b/gi, "crop top"],
];

const SENSITIVE_WORDS = [
  /\b(skin|bare\s+skin|naked|nude|nudity|cleavage|exposed|revealing|skinny|sleeveless)\b/gi,
  /\b(bikini|swimsuit|swimwear|lingerie|underwear|undergarment|panties|bra|thong|g\s*string|nightwear|night\s*gown|robe\s+open|intimate)\b/gi,
  /\b(body|figure|silhouette|curves|legs?|arms?|shoulders?|chest|back|torso)\b/gi,
  /\b(person\s+wearing|model\s+wearing|woman\s+wearing|man\s+wearing|girl\s+wearing|boy\s+wearing|female\s+model|male\s+model)\b/gi,
];

function sanitizeDescription(text: string): string {
  let out = text;
  for (const [p, safe] of SAFE_REPLACEMENTS) out = out.replace(p, safe);
  for (const p of SENSITIVE_WORDS) out = out.replace(p, "");
  return out
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * Three prompt levels — VERBATIM from the working cloud-ai-adapter
 * buildTryOnPrompt (the system the user confirmed works well).
 * `targetClause` is appended only for multi-person source photos.
 */
function buildTryOnPrompt(
  level: 1 | 2 | 3,
  garmentDescription: string,
  hasGarmentImage: boolean,
  targetClause: string
): string {
  const garmentRefNote = hasGarmentImage
    ? `\n\nREFERENCE: The second image provided is the EXACT outfit to apply. Replicate its shape, color, fabric, collar, sleeves, buttons, pattern, and ALL structural details precisely — including EVERY piece (upper AND lower) when the reference shows a full outfit. Do NOT invent a different garment — use this exact one.`
    : "";

  const base = `Professional fashion photography virtual try-on.

NEW GARMENT:
${garmentDescription || "(see reference image)"}${garmentRefNote}

PHOTOGRAPHY PRESERVATION:
- Keep the exact face, facial features, and expression unchanged
- Keep the exact pose, posture, and silhouette unchanged
- Keep the same hair, hairstyle, and hair color
- Keep the same background, environment, and scene composition
- Keep the same camera angle, lens perspective, and depth of field
- Keep the same image quality, grain, and overall photographic style

WARDROBE STYLING:
- The new garment fits naturally with realistic fabric folds, drapes, and wrinkles
- Match the existing photo's lighting direction, color temperature, and shadow style on the new garment

FULL OUTFIT MATCH (TOP + BOTTOM):
- The person must wear the COMPLETE reference outfit: if the reference includes a lower piece (shorts, pants, skirt, or bottom piece), the person's original lower garment MUST be fully replaced by that exact lower piece — same color, fabric, pattern, and length
- Do NOT keep the original pants/skirt/bottom, and do NOT generate a different lower garment that is not in the reference
- Head-to-ankle rule: every visible clothing area (upper AND lower) must come from the reference outfit

RESULT: photorealistic fashion editorial photograph.`;

  if (level === 1) {
    return `${base}${targetClause}

OUTFIT CHANGE: Replace this person's current outfit entirely with the new garment described above.
The original outfit must be fully replaced — only the new garment should be visible on the person.`;
  }

  if (level === 2) {
    return `${base}${targetClause}

CRITICAL OUTFIT REPLACEMENT:
- REPLACE the person's current outfit with the new garment described above
- The original clothing MUST be COMPLETELY REMOVED AND REPLACED
- No trace of the original outfit should remain visible — not even partially
- The person must NOT be wearing their original outfit anymore — they are now wearing ONLY the new garment
- The new garment is worn INSTEAD OF the old outfit, NOT on top of it
- NO LAYERING — the old outfit must be INVISIBLE under the new garment

Apply the EXACT garment described above — same color, fabric, pattern, cut, and style. Do NOT change the garment color or style.`;
  }

  // Level 3 — strongest
  return `${base}${targetClause}

ABSOLUTE OUTFIT REPLACEMENT (NO LAYERING):
The person's original clothing MUST be COMPLETELY REMOVED. The new garment REPLACES the original outfit entirely.

STRICT RULES:
1. The original outfit must be INVISIBLE in the result
2. The new garment is worn INSTEAD OF the old outfit, NOT layered on top
3. NO part of the original clothing (collar, sleeves, hem, color) should be visible anywhere
4. The new garment is the ONLY outfit the person is wearing
5. Apply the EXACT garment described above — same color, fabric, pattern, cut, style, buttons
6. If the new garment is a shirt, only the new shirt is visible — not the old shirt under it

FAILURE CONDITION: If any part of the original outfit is still visible, the result is FAILED and must be regenerated.`;
}

/**
 * Position name of a person among all detected persons (leftmost, second
 * from left, ...). Returns null for single-person photos.
 */
function personPositionName(sp: PersonBox, all: PersonBox[]): string | null {
  if (all.length <= 1) return null;
  const byLeft = [...all].sort((a, b) => (a.bbox[0] + a.bbox[2]) / 2 - (b.bbox[0] + b.bbox[2]) / 2);
  const pos = byLeft.findIndex((p) => p.index === sp.index);
  if (pos < 0) return null;
  const names = [
    "leftmost person (the first person from the left side of the photo)",
    "second person from the left",
    "third person from the left",
    "fourth person from the left",
    "fifth person from the left",
    "sixth person from the left",
  ];
  if (pos === byLeft.length - 1 && byLeft.length > 2) {
    return "rightmost person (the last person on the right side of the photo)";
  }
  return names[pos] ?? `${pos + 1}th person from the left`;
}

/**
 * TARGET clause for multi-person photos: identifies WHICH person gets the
 * new outfit by ordinal horizontal position, freezes everyone else.
 */
function buildTargetClause(sp: PersonBox, all: PersonBox[]): string {
  const who = personPositionName(sp, all);
  if (!who) return "";
  return `

TARGET PERSON: Multiple people appear in this photo. Replace the outfit of ONLY the ${who} with the new garment.
ALL other people must remain EXACTLY unchanged — same clothing, same faces, same poses, same everything.`;
}

/**
 * VLM Verification — VERBATIM from the working try-on pipeline
 * (verifyTryOnResult): checks oldOutfitVisible ONLY. One optional
 * target-person sentence is added for multi-person photos so the check
 * evaluates the mapped person, not bystanders.
 */
async function verifySwapResult(
  zai: any,
  resultDataUrl: string,
  sourceDataUrl: string,
  garmentDescription: string,
  targetWho?: string | null
): Promise<{ score: number; reason: string; oldOutfitVisible: boolean }> {
  try {
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `I'm testing a virtual try-on AI. Compare these two images:

- Image 1: SOURCE (before try-on) — the person's original outfit
- Image 2: RESULT (after try-on) — the person should be wearing a new garment: ${garmentDescription.slice(0, 200)}
${targetWho ? `\nTARGET PERSON: ${targetWho}. Evaluate THAT specific person only — any other person(s) are bystanders whose clothing does not matter for this check. If the TARGET person is still wearing their ORIGINAL outfit from Image 1, mark oldOutfitVisible=true (failure) even if other people changed.` : ""}
Evaluate:
1. Is the person's face, pose, hair, and background preserved in Image 2?
2. Is the new garment (${garmentDescription.slice(0, 100)}...) clearly visible in Image 2?
3. CRITICAL: Can you still see ANY part of the original outfit from Image 1 in Image 2 — INCLUDING the original lower garment (pants, skirt, shorts)? (layering failure)
4. LOWER PIECE CHECK: If the new garment description includes a lower piece (shorts/pants/skirt/bottom), does the person's lower garment in Image 2 MATCH the described lower piece (same color/length/style)? Mark oldOutfitVisible=true if the result still shows the ORIGINAL lower garment from Image 1, or an invented bottom that does not match the description.

Output JSON only:
{
  "facePreserved": true/false,
  "newGarmentVisible": true/false,
  "oldOutfitVisible": true/false,
  "score": 0-100,
  "reason": "one sentence explanation"
}`,
            },
            { type: "image_url", image_url: { url: sourceDataUrl } },
            { type: "image_url", image_url: { url: resultDataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    } as any);
    const text = response?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: Number(parsed.score) || 0,
          reason: parsed.reason || "unknown",
          oldOutfitVisible: !!parsed.oldOutfitVisible,
        };
      } catch { /* fall through */ }
    }
    return { score: 50, reason: "Could not parse verification response", oldOutfitVisible: false };
  } catch (e) {
    console.warn("[garment-swap] verification failed:", e);
    return { score: 50, reason: "Verification error", oldOutfitVisible: false };
  }
}

/** Is this a content-filter rejection from the edit API? */
function isContentFilterError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  return /content (filter|policy)|safety|blocked|Sensitive|flagged|1301|contentFilter/i.test(msg);
}

/** Error carrying an HTTP status for uniform response mapping. */
class SwapHttpError {
  constructor(public status: number, public error: string, public message?: string) {}
  toString(): string { return this.message ?? this.error; }
}

type SwapParams = {
  sourcePath: string;
  /** ONE OR MORE reference images (multi-reference support). */
  garmentPaths: string[];
  mappings: Array<{ sourceIndex: number; refIndex: number; refImage: number }>;
  /** How many result variations to generate (from settings عدد النتائج). */
  numResults: number;
};

function parseSwapParams(body: any): { params?: SwapParams; error?: string; message?: string } {
  const sourcePath: string = body?.sourcePath;
  // Multi-reference: garmentPaths[] — fallback to the legacy single fields.
  const rawPaths: string[] = Array.isArray(body?.garmentPaths)
    ? body.garmentPaths.filter((p: unknown) => typeof p === "string" && p.trim())
    : [];
  const legacyPath: string = body?.garmentPath || body?.refPath;
  const garmentPaths = (rawPaths.length ? rawPaths : legacyPath ? [legacyPath] : []).slice(0, 6);
  const rawMappings = Array.isArray(body?.mappings) ? body.mappings : [];
  const mappings = rawMappings
    .filter((m: any) => m && Number.isInteger(Number(m.sourceIndex)) && Number.isInteger(Number(m.refIndex)))
    .slice(0, 6)
    .map((m: any) => ({
      sourceIndex: Number(m.sourceIndex),
      refIndex: Number(m.refIndex),
      refImage: Math.max(0, Math.min(Number.isInteger(Number(m.refImage)) ? Number(m.refImage) : 0, garmentPaths.length - 1)),
    }));
  if (!sourcePath || !garmentPaths.length) {
    return { error: "Missing sourcePath or garmentPath" };
  }
  if (!mappings.length) {
    return { error: "Missing mappings", message: "حدد ربطاً واحداً على الأقل (مصدر ← مرجع)" };
  }
  // Multi-result: honor the studio settings (1 | 2 | 4 | 8) — each run is an
  // independent generation so the results differ from one another.
  const rawNum = Number(body?.numResults);
  const numResults = [1, 2, 4, 8].includes(rawNum) ? rawNum : 1;
  return { params: { sourcePath, garmentPaths, mappings, numResults } };
}

/** Map a thrown error to an HTTP NextResponse (sync mode). */
function swapErrorResponse(e: unknown): NextResponse {
  if (e instanceof SwapHttpError) {
    return NextResponse.json({ error: e.error, message: e.message }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/File not found|empty/i.test(msg)) {
    return NextResponse.json(
      { error: "File not found", message: "تعذر الوصول إلى صورة المصدر أو المرجع — أعد رفعها ثم حاول مجدداً." },
      { status: 404 }
    );
  }
  return NextResponse.json({ error: "Garment swap failed", message: msg }, { status: 500 });
}

function busyResponse(): NextResponse {
  const status = getProcessingStatus();
  return NextResponse.json({
    error: `عملية "${status.op}" جارية الآن (${Math.round(status.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`,
    retryAfter: 5, busyWith: status.op,
  }, { status: 429 });
}

/**
 * The SAME pipeline as the working cloud-ai-adapter try-on, driven per
 * mapping. Throws SwapHttpError on failure. Reports progress through
 * onStage (Arabic + English labels) when provided.
 */
async function runSwapPipeline(
  params: SwapParams,
  onStage?: (stage: string, labelAr: string, labelEn: string, percent: number) => void
): Promise<Record<string, unknown>> {
  const { sourcePath, garmentPaths, mappings } = params;
  const srcAbs = await resolveFilePath(sourcePath);
  const refAbsList = await Promise.all(garmentPaths.map((p) => resolveFilePath(p)));

  const up = await spawnServiceIfDown();
  if (!up) throw new SwapHttpError(503, "Detection service unavailable", "خدمة الرصد غير متاحة — أعد المحاولة.");

  onStage?.("detect", "جاري رصد الأشخاص في الصور…", "Detecting persons in all images…", 12);
  const [srcPersons, ...refPersonsList] = await Promise.all([
    detectPersons(srcAbs),
    ...refAbsList.map((p) => detectPersons(p)),
  ]);
  if (!srcPersons.length) throw new SwapHttpError(422, "No person detected in source", "لم يُرصد أي شخص في صورة المصدر");
  // Only the reference images actually used by a mapping must contain a
  // detectable person (extra unused images may stay person-free).
  const usedRefImages = new Set(mappings.map((m) => m.refImage));
  for (const ri of usedRefImages) {
    if (!refPersonsList[ri]?.length) {
      throw new SwapHttpError(422, `No person detected in reference #${ri + 1}`, `لم يُرصد أي شخص في صورة المرجع رقم ${ri + 1}`);
    }
  }

  // Auto-orient ONCE (EXIF) — detection coordinates are relative to the
  // oriented pixels.
  const srcBuf = await sharp(await fs.readFile(srcAbs), { failOn: "none" }).rotate().png().toBuffer();
  const refBufs: Buffer[] = [];
  const refSizes: Array<{ w: number; h: number }> = [];
  for (const refAbs of refAbsList) {
    const buf = await sharp(await fs.readFile(refAbs), { failOn: "none" }).rotate().png().toBuffer();
    const meta = await sharp(buf).metadata();
    refBufs.push(buf);
    refSizes.push({ w: meta.width ?? 0, h: meta.height ?? 0 });
  }

  const zaiModule = await import("z-ai-web-dev-sdk");
  const ZAI = (zaiModule as any).default ?? (zaiModule as any);
  const zai = await ZAI.create();

  // ---- Full source photo, aspect-preserved (same as working try-on:
  //      the WHOLE image is sent; pickBestSize matches its aspect so
  //      the model returns the same framing).
  const sendImg = await imageForEdit(srcBuf, 1536);
  const size = pickBestSize(sendImg.w, sendImg.h);

  // ---- Per-(reference-image, person) cache: extract-on-white + VLM
  //      description (identical to working pipeline steps 1-2).
  const garmentCache = new Map<string, { garmentUrl: string | null; description: string }>();
  const getGarment = async (refImage: number, refIndex: number, mappingNo: number, mappingTotal: number) => {
    const cacheKey = `${refImage}:${refIndex}`;
    if (garmentCache.has(cacheKey)) return garmentCache.get(cacheKey)!;
    onStage?.(
      `prepare-${mappingNo}`,
      `استخراج القطعة ووصفها (${mappingNo}/${mappingTotal})…`,
      `Extracting & describing garment (${mappingNo}/${mappingTotal})…`,
      22 + (mappingNo - 1) * 6
    );
    const rp = refPersonsList[refImage]?.[refIndex];
    if (!rp) return { garmentUrl: null, description: "" };
    const { w: refW, h: refH } = refSizes[refImage];
    const rl = Math.max(0, Math.floor(rp.bbox[0] * refW));
    const rt = Math.max(0, Math.floor(rp.bbox[1] * refH));
    const rw = Math.min(refW - rl, Math.ceil((rp.bbox[2] - rp.bbox[0]) * refW));
    const rh = Math.min(refH - rt, Math.ceil((rp.bbox[3] - rp.bbox[1]) * refH));
    const refTorso = await sharp(refBufs[refImage])
      .extract({ left: rl, top: rt, width: Math.max(16, rw), height: Math.max(16, rh) })
      .png().toBuffer();
    const torsoForAI = await imageForEdit(refTorso, 1024);
    // 1) garment-only extraction (visual reference; fallback: the torso
    //    crop itself). NOTE: extraction is stochastic and sometimes drops
    //    the LOWER piece of a set — so the DESCRIPTION is taken from the
    //    full torso crop (always shows the complete outfit), not from
    //    the extracted image.
    const garmentUrl = (await extractGarmentOnWhite(zai, torsoForAI.dataUrl)) ?? torsoForAI.dataUrl;
    // 2) precise VLM description of the COMPLETE outfit from the crop
    const rawDesc = await describeGarment(zai, torsoForAI.dataUrl);
    const description = sanitizeDescription(rawDesc);
    const entry = { garmentUrl, description };
    garmentCache.set(cacheKey, entry);
    return entry;
  };

  const multiPerson = srcPersons.length > 1;
  let resultBuf: Buffer | null = null;
  const applied: Array<{ sourceIndex: number; refIndex: number; attempts: number }> = [];

  // CHAINED edits: mapping k edits the RESULT of mapping k-1 (with 2+
  // mappings, restarting from the original would erase earlier swaps).
  let currentImg = sendImg;

  let mappingNo = 0;
  for (const mp of mappings) {
    mappingNo++;
    const sp = srcPersons[mp.sourceIndex];
    if (!sp) continue;
    const refInfo = await getGarment(mp.refImage, mp.refIndex, mappingNo, mappings.length);
    if (!refInfo.garmentUrl) continue;

    const targetClause = multiPerson ? buildTargetClause(sp, srcPersons) : "";

    // --------------------------------------------------------------
    // Working try-on flow (cloud-ai-adapter): level prompts + VLM
    // verification on attempts 1-2 (old outfit AND bottom-garment
    // match); the last attempt always ships. Max 3 attempts only on
    // API errors.
    // --------------------------------------------------------------
    let success = false;
    let attempts = 0;
    let finalRejected = false;

    while (!success && attempts < 3) {
      attempts++;
      onStage?.(
        `edit-${mappingNo}-${attempts}`,
        `توليد الملابس الجديدة (${mappingNo}/${mappings.length})…`,
        `Generating new garment (${mappingNo}/${mappings.length})…`,
        40 + ((mappingNo - 1) / mappings.length) * 45
      );
      const prompt = buildTryOnPrompt(attempts as 1 | 2 | 3, refInfo.description, true, targetClause);
      // images array: first = the photo being edited; second = the
      // extracted garment reference. Sent on EVERY attempt — the visual
      // reference is the strongest signal for replicating the exact
      // outfit (especially the lower piece).
      const images: Array<{ url: string }> = [{ url: currentImg.dataUrl }, { url: refInfo.garmentUrl }];

      let outB64: string | undefined;
      try {
        const editRes = await (zai.images.generations.edit as any)({ prompt, images, size });
        outB64 = editRes?.data?.[0]?.base64;
      } catch (e) {
        if (!isContentFilterError(e)) throw e;
        // Content-filter → safe retry prompt (same as working pipeline)
        const safeRes = await (zai.images.generations.edit as any)({
          prompt:
            `Fashion photography: This person is wearing ${refInfo.description || "a new stylish garment"}. ` +
            "Photorealistic fashion editorial photograph. Preserve the person's face, pose, hair, and background exactly. " +
            "Apply the new garment with realistic folds and lighting." + targetClause,
          images: [{ url: currentImg.dataUrl }],
          size,
        });
        outB64 = safeRes?.data?.[0]?.base64;
      }
      if (!outB64) throw new Error("AI returned no image");
      const edited = Buffer.from(outB64, "base64");
      if (edited.length < 1000) throw new Error("AI result too small");

      const attemptDataUrl = `data:image/png;base64,${outB64}`;

      // VLM verification — on attempts 1 and 2 (checks old outfit AND
      // that the lower garment matches the reference); the last attempt
      // always ships.
      if (attempts <= 2) {
        onStage?.(
          `verify-${mappingNo}`,
          "فحص جودة النتيجة…",
          "Verifying result quality…",
          60 + ((mappingNo - 1) / mappings.length) * 30
        );
        const verification = await verifySwapResult(
          zai,
          attemptDataUrl,
          currentImg.dataUrl,
          refInfo.description,
          multiPerson ? personPositionName(sp, srcPersons) : null
        );
        if (verification.oldOutfitVisible && attempts < 3) {
          finalRejected = true;
          console.warn(
            `[garment-swap] verification failed (attempt ${attempts}): ${verification.reason} — retrying with stronger prompt`
          );
          continue; // retry with stronger prompt
        }
        finalRejected = false; // verified OK
      }

      success = true;
      resultBuf = edited;
      // Chain: the next mapping edits THIS result. ALWAYS chained — every
      // mapped person must end up changed in the final photo (a rejected
      // final attempt still ships for its own mapping).
      if (finalRejected) {
        console.warn(
          `[garment-swap] mapping ${mappingNo}: last attempt still rejected — shipping it as-is`
        );
      }
      currentImg = { dataUrl: attemptDataUrl, w: sendImg.w, h: sendImg.h };
    }

    applied.push({ sourceIndex: mp.sourceIndex, refIndex: mp.refIndex, attempts });
  }

  if (!applied.length || !resultBuf) {
    throw new SwapHttpError(400, "No valid mapping applied", "لا يوجد ربط صالح");
  }

  onStage?.("saving", "حفظ النتيجة النهائية…", "Saving final result…", 96);

  const out = `garment-swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const outPath = path.join(path.resolve(process.cwd(), "data/results"), out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, resultBuf);
  const fm = await sharp(resultBuf).metadata();

  return {
    url: `/results/${out}`,
    path: outPath,
    width: fm.width ?? sendImg.w,
    height: fm.height ?? sendImg.h,
    size: resultBuf.length,
    method: "cloud-ai-garment-swap",
    applied,
  };
}

/**
 * POST — two modes:
 *  - async:  body.async === true → starts a background job and returns
 *            { ok, jobId } in <1s. The UI polls GET?jobId=… This avoids
 *            preview-proxy timeouts that killed the long single request
 *            (the "فشل تبديل الملابس" while the server actually succeeded).
 *  - sync:   default → runs inline and returns the full result (curl/tests).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { params, error, message } = parseSwapParams(body);
  if (!params) {
    return NextResponse.json({ error: error, message }, { status: 400 });
  }

  // ---------------- async mode (used by the UI) ----------------
  if (body?.async === true) {
    if (!tryAcquireProcessingLock("garment-swap")) return busyResponse();
    const jobId = `gs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createSwapJob(jobId);
    // Background execution — NOT awaited; survives any client/proxy timeout.
    void (async () => {
      try {
        const n = Math.max(1, params.numResults || 1);
        const all: Array<Record<string, unknown>> = [];
        let first: Record<string, unknown> | undefined;
        for (let r = 0; r < n; r++) {
          // Scale each run's inner progress into its slice of 0-100.
          const slice = 100 / n;
          const result = await runSwapPipeline(params, (stage, ar, en, percent) => {
            const scaled = r * slice + (percent / 100) * slice;
            const tag = n > 1 ? ` [النتيجة ${r + 1}/${n}]` : "";
            updateSwapStage(jobId, stage, (ar || "") + tag, (en || "") + (n > 1 ? ` [result ${r + 1}/${n}]` : ""), scaled);
          });
          if (!first) first = result;
          all.push(result);
        }
        finishSwapJob(jobId, first!, all);
        console.log(`[garment-swap] job ${jobId} done (${all.length} result(s))`);
      } catch (e) {
        const msg = (e as any)?.message ?? (e instanceof Error ? e.message : String(e));
        console.warn(`[garment-swap] job ${jobId} failed: ${msg}`);
        failSwapJob(jobId, e instanceof SwapHttpError ? e.error : "Garment swap failed", msg);
      } finally {
        releaseProcessingLock();
      }
    })();
    return NextResponse.json({ ok: true, jobId });
  }

  // ---------------- sync mode (backwards compatible) ----------------
  if (!tryAcquireProcessingLock("garment-swap")) return busyResponse();
  try {
    const result = await runSwapPipeline(params);
    return NextResponse.json(result);
  } catch (e) {
    return swapErrorResponse(e);
  } finally {
    releaseProcessingLock();
  }
}

/** GET?jobId=… — poll an async swap job (short-lived response, proxy-safe). */
export async function GET(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const job = getSwapJob(jobId);
  if (!job) return NextResponse.json({ error: "Unknown jobId", message: "المهمة غير موجودة أو انتهت صلاحيتها" }, { status: 404 });
  return NextResponse.json({ ok: true, ...job });
}
