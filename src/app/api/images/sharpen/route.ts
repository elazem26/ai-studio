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
  const amount = Math.min(5, Math.max(0.1, body.amount ?? 1.5));
  try {
    const buffer = await sharp(body.sourcePath).sharpen({ sigma: amount, amount: amount * 0.8, threshold: 1 }).png({ quality: 92 }).toBuffer();
    const outName = `sharpen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Sharpened sigma=${amount}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, size: buffer.length, amount, method: "sharp-sharpen" });
  } catch (e) { return NextResponse.json({ error: "Sharpen failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
