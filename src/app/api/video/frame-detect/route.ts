import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import path from "path";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const R = path.resolve(process.cwd(), "data/results");
const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";

async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${MINI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

/**
 * POST /api/video/frame-detect
 * Body: { videoPath } — extracts a representative frame and detects
 * faces (numbered) + persons (torso boxes) on it.
 * Returns: { posterUrl, faces, persons }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const videoPath: string | undefined = body.videoPath;
  if (!videoPath) return NextResponse.json({ error: "Missing videoPath" }, { status: 400 });

  try {
    const videoAbs = await resolveFilePath(videoPath);
    const name = `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const posterAbs = path.join(R, name);

    const tryAt = (ss: string) =>
      new Promise<boolean>((resolve) =>
        execFile("ffmpeg", ["-y", "-ss", ss, "-i", videoAbs, "-frames:v", "1", "-vf", "scale=1280:-2", posterAbs],
          { timeout: 60_000 }, (err) => resolve(!err))
      );
    let ok = await tryAt("1");
    if (!ok) ok = await tryAt("0");
    if (!ok || !(await fs.stat(posterAbs).then(() => true).catch(() => false))) {
      return NextResponse.json({ error: "FRAME_EXTRACT_FAILED", message: "تعذر استخراج إطار من الفيديو" }, { status: 500 });
    }

    if (!(await isMiniServiceUp())) {
      return NextResponse.json({ error: "SERVICE_DOWN", message: "خدمة الرصد غير متاحة" }, { status: 503 });
    }

    const buf = await fs.readFile(posterAbs);
    const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
    // Parallel detection (detect + detect-persons) — ~2x faster
    const call = async (endpoint: "detect" | "detect-persons"): Promise<any[]> => {
      try {
        const res = await fetch(`${MINI_SERVICE_URL}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
          signal: AbortSignal.timeout(60_000),
        });
        const d: any = await res.json().catch(() => ({}));
        if (res.ok && d?.ok) return (endpoint === "detect" ? d.faces : d.persons) ?? [];
      } catch { /* keep empty */ }
      return [];
    };
    const [faces, persons] = await Promise.all([call("detect"), call("detect-persons")]);

    return NextResponse.json({ ok: true, posterUrl: `/results/${name}`, faces, persons });
  } catch (e) {
    return NextResponse.json(
      { error: "frame-detect failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
