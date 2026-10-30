import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { aiEditFrameLocked } from "@/lib/ai-image-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

interface ChangeBackgroundBody {
  sourcePath: string;
  mode: "description" | "image" | "color" | "preset";
  /** Text description of the desired background (for "description" mode) */
  backgroundDescription?: string;
  /** Path to a background image file (for "image" mode) */
  backgroundImagePath?: string;
  /** Hex color like "#1a2b3c" (for "color" mode) */
  backgroundColor?: string;
  /** Preset category+name like "nature/forest" (for "preset" mode) */
  presetCategory?: string;
  presetName?: string;
}

const PRESETS: Record<string, Record<string, { description: string; color: string }>> = {
  nature: {
    forest:    { description: "Dense green forest with sunlight filtering through tall trees, moss-covered ground, dappled light", color: "#2d5016" },
    beach:     { description: "Tropical beach with white sand, turquoise water, clear blue sky, gentle waves", color: "#87CEEB" },
    mountains: { description: "Snow-capped mountain peaks under a clear blue sky, alpine landscape, crisp air", color: "#4a6fa5" },
    sunset:    { description: "Golden sunset over a calm ocean, orange and purple sky, silhouette of palm trees", color: "#ff6b35" },
    garden:    { description: "Lush flower garden with roses, tulips, and lavender, soft bokeh background, sunny day", color: "#5a9b5e" },
    desert:    { description: "Vast desert with golden sand dunes, clear blue sky, heat haze on the horizon", color: "#c2a878" },
  },
  indoor: {
    studio:      { description: "Professional photography studio with white seamless backdrop, soft studio lighting, clean minimal", color: "#f0f0f0" },
    livingRoom:  { description: "Modern living room with warm lighting, sofa, bookshelf, wooden floor, cozy atmosphere", color: "#3a2a1a" },
    office:      { description: "Clean modern office with glass walls, desk, ergonomic chair, bright fluorescent lighting", color: "#2a3a4a" },
    bedroom:     { description: "Cozy bedroom with warm lamp light, soft bed, curtains, intimate ambiance", color: "#2a1a2a" },
    kitchen:     { description: "Modern kitchen with marble countertops, stainless steel appliances, warm under-cabinet lighting", color: "#3a3a3a" },
    library:     { description: "Classic library with tall wooden bookshelves, warm reading lamp, leather chairs, scholarly atmosphere", color: "#3a2010" },
  },
  urban: {
    cityNight:   { description: "City street at night with neon lights, reflections on wet pavement, bokeh street lamps, urban atmosphere", color: "#0a0a2a" },
    skyline:     { description: "Rooftop view of a modern city skyline at golden hour, skyscrapers, clear sky", color: "#4a5a6a" },
    cafe:        { description: "Cozy Parisian cafe interior with warm lighting, wooden tables, plants, ambient atmosphere", color: "#3a2a1a" },
    street:      { description: "European cobblestone street with old buildings, warm afternoon light, charming architecture", color: "#5a4a3a" },
    subway:      { description: "Modern subway station with bright fluorescent lighting, clean tiles, urban transit atmosphere", color: "#2a2a3a" },
    bridge:      { description: "Iconic bridge at sunset, cityscape in background, golden light reflecting on water", color: "#5a4a3a" },
  },
  abstract: {
    gradient1:   { description: "Smooth gradient background from deep purple to bright pink, soft blurred", color: "#2d1b4e" },
    gradient2:   { description: "Soft blue to teal gradient, calm and professional, minimal", color: "#1a3a4a" },
    gradient3:   { description: "Warm orange to yellow gradient, sunny and cheerful, soft bokeh", color: "#ff8c00" },
    bokeh:       { description: "Abstract bokeh with soft circular light spots in warm colors, dreamy atmosphere", color: "#1a1a2a" },
    geometric:   { description: "Abstract geometric pattern with triangles in purple and blue, modern art style", color: "#2a1a4a" },
    minimal:     { description: "Minimal solid dark gray background, professional, clean, studio quality", color: "#1a1a1a" },
  },
};

/**
 * POST /api/images/change-background
 *
 * Replaces the background of a photo with a new background specified via:
 *   - description (text prompt for AI)
 *   - image (path to a background image file)
 *   - color (solid hex color)
 *   - preset (category/name from the built-in preset library)
 *
 * Uses AI image-edit to intelligently blend the subject with the new background.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ChangeBackgroundBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  try {
    await fs.access(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  let backgroundPrompt = "";
  let fallbackColor = "#1a1a2e";

  if (body.mode === "description" && body.backgroundDescription) {
    backgroundPrompt = body.backgroundDescription;
  } else if (body.mode === "color" && body.backgroundColor) {
    backgroundPrompt = `Solid ${body.backgroundColor} colored background, clean and even, studio backdrop`;
    fallbackColor = body.backgroundColor;
  } else if (body.mode === "preset" && body.presetCategory && body.presetName) {
    const category = PRESETS[body.presetCategory];
    if (category && category[body.presetName]) {
      const preset = category[body.presetName];
      backgroundPrompt = preset.description;
      fallbackColor = preset.color;
    } else {
      return NextResponse.json({ error: "Preset not found" }, { status: 400 });
    }
  } else if (body.mode === "image" && body.backgroundImagePath) {
    try {
      await fs.access(body.backgroundImagePath);
    } catch {
      return NextResponse.json({ error: "Background image not found" }, { status: 404 });
    }
    // For image mode, we'll composite using AI — the prompt describes what to do
    backgroundPrompt = "Replace the background with the provided background image. Keep the subject perfectly intact. Blend naturally.";
  } else {
    return NextResponse.json({ error: "Invalid mode or missing parameters" }, { status: 400 });
  }

  try {
    // If background image mode, load the reference image to send alongside
    const extraImages: Array<{ url: string }> = [];
    if (body.mode === "image" && body.backgroundImagePath) {
      const bgExt = path.extname(body.backgroundImagePath).toLowerCase();
      const bgMime = bgExt === ".png" ? "image/png" : "image/jpeg";
      const bgB64 = (await fs.readFile(body.backgroundImagePath)).toString("base64");
      extraImages.push({ url: `data:${bgMime};base64,${bgB64}` });
    }

    const prompt = `Replace the background of this photo with: ${backgroundPrompt}

YOUR JOB:
1. IDENTIFY the main subject (person, object, or focus) in the photo
2. REMOVE the current background completely
3. PLACE the subject onto the NEW background described above
4. BLEND naturally — match lighting, shadows, reflections, color temperature
5. PRESERVE the subject's identity, pose, clothing, expression EXACTLY
6. Add realistic shadows that the subject would cast on the new background
7. Keep the exact same framing, subject size and position, and the FULL field of view — do not crop, zoom, or shift the frame

DO NOT:
- Change the subject's face, body, clothing, or expression
- Add new objects or people
- Distort or stretch the subject
- Leave any visible edges or "cutout" artifacts around the subject
- Change the subject's size or position dramatically

RESULT: A photorealistic image where the subject is naturally placed in the new background. The lighting and shadows must be consistent between subject and background.`;

    // Frame-locked: no backend center-crop, result at the source's exact
    // dimensions. edgeLock=false — the background (border bands) changes.
    const result = await aiEditFrameLocked({
      sourcePath: body.sourcePath,
      prompt,
      edgeLock: false,
      extraImages,
    });
    const finalBuffer = result.buffer;
    const srcW = result.width;
    const srcH = result.height;

    const outName = `bg-changed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, finalBuffer);

    await logEvent({
      category: "tryon",
      message: `Background changed (${body.mode}): ${srcW}x${srcH}`,
      details: `prompt=${backgroundPrompt.slice(0, 100)}`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: srcW,
      height: srcH,
      size: finalBuffer.length,
      mode: body.mode,
      method: "ai-background-replace",
      backgroundPrompt: backgroundPrompt.slice(0, 200),
    });
  } catch (e) {
    await logEvent({
      category: "tryon",
      level: "error",
      message: "Background change failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Background change failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}

export { PRESETS as BACKGROUND_PRESETS };
