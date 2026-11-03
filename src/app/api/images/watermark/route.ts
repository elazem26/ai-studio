import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }
  await fs.mkdir(RESULTS_ROOT, { recursive: true });
  const text = body.text ?? "AI Clothing Studio";
  const opacity = Math.min(1, Math.max(0.1, body.opacity ?? 0.3));
  const fontSize = Math.min(200, Math.max(12, body.fontSize ?? 48));
  const position = body.position ?? "bottom-right";
  try {
    const sourceMeta = await sharp(body.sourcePath).metadata();
    const srcW = sourceMeta.width ?? 768, srcH = sourceMeta.height ?? 1024;
    // Create SVG watermark
    const textW = text.length * fontSize * 0.6;
    const svg = `<svg width="${srcW}" height="${srcH}" xmlns="http://www.w3.org/2000/svg">
      <style>.wm { font-family: Arial, sans-serif; font-size: ${fontSize}px; fill: rgba(255,255,255,${opacity}); font-weight: bold; }</style>
      ${position === "center" ? `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="wm" transform="rotate(-30, ${srcW/2}, ${srcH/2})">${text}</text>` :
        position === "top-left" ? `<text x="20" y="${fontSize + 10}" class="wm">${text}</text>` :
        position === "top-right" ? `<text x="${srcW - textW - 20}" y="${fontSize + 10}" class="wm">${text}</text>` :
        position === "bottom-left" ? `<text x="20" y="${srcH - 20}" class="wm">${text}</text>` :
        `<text x="${srcW - textW - 20}" y="${srcH - 20}" class="wm">${text}</text>`}
    </svg>`;
    const svgBuffer = Buffer.from(svg);
    const buffer = await sharp(body.sourcePath).composite([{ input: svgBuffer, blend: "over" }]).png({ quality: 92 }).toBuffer();
    const outName = `watermark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Watermark: "${text}" at ${position}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, text, position, opacity, method: "sharp-watermark" });
  } catch (e) { return NextResponse.json({ error: "Watermark failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
