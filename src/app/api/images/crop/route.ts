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
  const { left = 0, top = 0, width: cropW, height: cropH } = body;
  try {
    const meta = await sharp(body.sourcePath).metadata();
    const srcW = meta.width ?? 768, srcH = meta.height ?? 1024;
    const w = cropW && cropW > 0 ? Math.min(cropW, srcW - left) : Math.round(srcW / 2);
    const h = cropH && cropH > 0 ? Math.min(cropH, srcH - top) : Math.round(srcH / 2);
    const l = Math.max(0, Math.min(left, srcW - w));
    const t = Math.max(0, Math.min(top, srcH - h));
    const buffer = await sharp(body.sourcePath).extract({ left: l, top: t, width: w, height: h }).png({ quality: 92 }).toBuffer();
    const outName = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Cropped: ${l},${t} ${w}x${h}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: w, height: h, size: buffer.length, method: "sharp-crop" });
  } catch (e) { return NextResponse.json({ error: "Crop failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
