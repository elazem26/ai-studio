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
  const filter = body.filter ?? "grayscale";
  try {
    let s = sharp(body.sourcePath);
    switch (filter) {
      case "grayscale": case "grey": case "gray":
        s = s.grayscale(); break;
      case "sepia":
        s = s.tint({ r: 112, g: 66, b: 20 }).modulate({ saturation: 0.6, brightness: 0.95 }); break;
      case "invert": case "negative":
        s = s.negate(); break;
      case "vintage":
        s = s.modulate({ saturation: 0.5, brightness: 0.9 }).tint({ r: 255, g: 200, b: 150 }); break;
      case "cool":
        s = s.modulate({ saturation: 1.2 }).tint({ r: 200, g: 220, b: 255 }); break;
      case "warm":
        s = s.modulate({ saturation: 1.15 }).tint({ r: 255, g: 220, b: 200 }); break;
      case "noir":
        s = s.grayscale().modulate({ brightness: 0.85, saturation: 0 }); break;
      case "vivid":
        s = s.modulate({ saturation: 1.5, brightness: 1.05 }); break;
      default:
        s = s.grayscale();
    }
    const buffer = await s.png({ quality: 92 }).toBuffer();
    const outName = `filter-${filter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Filter: ${filter}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, size: buffer.length, filter, method: "sharp-filter" });
  } catch (e) { return NextResponse.json({ error: "Filter failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
