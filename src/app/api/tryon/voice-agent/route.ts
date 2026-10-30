import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

interface VoiceAgentBody {
  sourcePath: string;
  /** User's request in natural language (Arabic or English) */
  request: string;
  /** Whether the request came from voice (transcribed) or text */
  inputMode?: "voice" | "text";
}

/**
 * POST /api/tryon/voice-agent
 *
 * AI agent that takes a natural-language request like:
 *   "أريد أن يرتدي بدلة رسمية لون أزرق"
 *   "Put a red winter coat on this person"
 *
 * Uses z-ai-web-dev-sdk chat to translate the request into a detailed
 * garment description, then uses images.generations.edit to perform
 * the clothing swap on the source image.
 *
 * Returns the generated result image.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as VoiceAgentBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  if (!body.request || !body.request.trim()) {
    return NextResponse.json({ error: "Missing request" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });
  const inputMode = body.inputMode ?? "text";

  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();

    // === STEP 1: Use AI chat to translate the user's request into a
    //              detailed garment description for the image-edit API ===
    const translationPrompt = `You are an AI clothing stylist. The user has given you a request (via ${inputMode}) to change the clothing of a person in a photo.

User's request: "${body.request}"

Translate this into a DETAILED English description of the garment(s) the person should be wearing. Include:
1. Garment type (suit, dress, casual shirt, etc.)
2. Color(s) — be specific (navy blue, crimson red, etc.)
3. Fabric/texture (wool, cotton, silk, denim, etc.)
4. Style (formal, casual, vintage, modern, etc.)
5. Fit (slim fit, loose, tailored, etc.)
6. Any accessories mentioned (tie, scarf, belt, etc.)
7. Details (buttons, collar style, pattern, etc.)

Reply with ONLY the detailed garment description in English. Be thorough but concise (max 3 sentences).`;

    const chatCompletion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: translationPrompt },
        { role: "user", content: body.request },
      ],
      thinking: { type: "disabled" },
    } as any);

    const garmentDescription = chatCompletion.choices?.[0]?.message?.content?.trim() || body.request;

    await logEvent({
      category: "tryon",
      message: `Voice agent: translated "${body.request.slice(0, 80)}" → "${garmentDescription.slice(0, 80)}"`,
    });

    // === STEP 2: Use AI image-edit to perform the clothing swap ===
    const ext = path.extname(body.sourcePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const sourceMeta0 = await sharp(body.sourcePath).metadata();
    const srcW0 = sourceMeta0.width ?? 1024;
    const srcH0 = sourceMeta0.height ?? 1024;
    // FRAME-LOCK: pick the closest supported canvas, then PRE-STRETCH the
    // source to its exact aspect so the edit backend never center-crops
    // the photo's edges (the "اقتصاص" bug). Inverse-stretch below cancels it.
    const sup = ["1024x1024","768x1344","864x1152","1344x768","1152x864","1440x720","720x1440"];
    let canvas: string = sup[0], bd = Infinity;
    for (const s of sup) { const [sw,sh] = s.split("x").map(Number); const d = Math.abs(sw/sh - srcW0/srcH0); if (d < bd) { bd = d; canvas = s; } }
    const [cW, cH] = canvas.split("x").map(Number);
    const fittedUrl = `data:image/png;base64,${(await sharp(Buffer.from(b64, "base64")).resize(cW, cH, { fit: "fill", kernel: "lanczos3" }).png().toBuffer()).toString("base64")}`;

    const editPrompt = `Virtual Try-On: Change the clothing of the person in this photo.

NEW GARMENT TO APPLY:
${garmentDescription}

CRITICAL REQUIREMENTS:
1. KEEP the person's face, body shape, skin tone, hair, and pose EXACTLY as they are
2. REPLACE their current clothing with the new garment described above
3. The new garment must fit naturally — match the body's proportions, pose, and angle
4. MATCH lighting, shadows, wrinkles, and fabric behavior to the scene
5. Preserve hands, arms, legs — the garment should interact naturally with the body
6. Keep the original background unchanged
7. Make it look like the person is ACTUALLY wearing this garment — not a Photoshop overlay

DO NOT:
- Change the person's identity, face, or expression
- Change the background or scene
- Add new people
- Distort the body proportions
- Leave any visible seams or artifacts

RESULT: A photorealistic image of the SAME person wearing the new garment naturally.`;

    const editResponse = await (zai.images.generations.edit as any)({
      prompt: editPrompt,
      images: [{ url: fittedUrl }],
      size: canvas,
    });

    const imageBase64 = editResponse.data?.[0]?.base64;
    if (!imageBase64) throw new Error("AI returned no image");

    const buffer = Buffer.from(imageBase64, "base64");

    // Resize back to original dimensions (inverse-stretch — cancels the
    // pre-stretch, restores true proportions and the full field of view)
    const srcW = srcW0;
    const srcH = srcH0;
    const resultMeta = await sharp(buffer).metadata();
    let finalBuffer: Buffer<ArrayBufferLike> = buffer;
    if (resultMeta.width !== srcW || resultMeta.height !== srcH) {
      finalBuffer = await sharp(buffer)
        .resize(srcW, srcH, { kernel: "lanczos3", fit: "fill" })
        .png({ quality: 92 })
        .toBuffer();
    }

    const outName = `voice-tryon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, finalBuffer);

    await logEvent({
      category: "tryon",
      message: `Voice agent try-on: ${inputMode} input → garment "${garmentDescription.slice(0, 60)}"`,
      durationMs: 0,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: srcW,
      height: srcH,
      size: finalBuffer.length,
      method: "ai-voice-agent-tryon",
      originalRequest: body.request,
      translatedGarmentDescription: garmentDescription,
      inputMode,
    });
  } catch (e) {
    await logEvent({
      category: "tryon",
      level: "error",
      message: "Voice agent try-on failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Voice agent failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
