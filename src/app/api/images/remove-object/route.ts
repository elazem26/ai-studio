import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath, dataRootSync } from "@/lib/security/resolve-file-path";
const DATA_ROOT = dataRootSync();
import { aiEditFrameLocked } from "@/lib/ai-image-edit";
import { getPythonBin, spawnSafe } from "@/lib/python-bin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULTS_ROOT = path.join(DATA_ROOT, "results");

// ---------------------------------------------------------------------------
// object-remover mini-service (port 3031) — mask-based LaMa inpainting.
// Same discovery rules as lib/mini-service.ts: the standalone server runs
// with cwd=.next/standalone which does NOT contain mini-services/, so walk up.
// ---------------------------------------------------------------------------
const INPAINT_URL = "http://127.0.0.1:3031/inpaint";

function findRemoverScript(): string {
  const rel = path.join("mini-services", "object-remover", "server.py");
  const cwd = process.cwd();
  const candidates = [path.join(cwd, rel), path.join(cwd, "..", "..", rel), path.join(cwd, "..", rel)];
  for (const c of candidates) {
    const r = path.resolve(c);
    if (r.includes(`${path.sep}.next${path.sep}`)) continue; // stale build copy — skip
    try { if (existsSync(r)) return r; } catch { /* ignore */ }
  }
  return path.resolve(candidates[0]);
}

async function isRemoverUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:3031/health", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function ensureRemoverService(): Promise<boolean> {
  if (await isRemoverUp()) return true;
  try {
    const proc = spawnSafe(getPythonBin(), [findRemoverScript()], {
      cwd: path.dirname(findRemoverScript()),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    proc.unref();
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isRemoverUp()) return true;
    }
  } catch { /* fallthrough */ }
  return await isRemoverUp();
}

async function localInpaint(absPath: string, maskDataUrl: string, growPx: number, featherPx: number) {
  const imgBuf = await fs.readFile(absPath);
  const maskB64 = maskDataUrl.includes(",") ? maskDataUrl.split(",")[1] : maskDataUrl;
  const r = await fetch(INPAINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64: imgBuf.toString("base64"),
      mask_b64: maskB64,
      growPx,
      featherPx,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d.error || `inpaint service HTTP ${r.status}`);
  return d as { image_b64: string; width: number; height: number; method: string; elapsedMs: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }
  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  // ------------------------------------------------------------------
  // MASK MODE — brush selection from the client → local LaMa inpainting.
  // Only the brushed region can change; the rest stays pixel-identical.
  // ------------------------------------------------------------------
  if (body.maskDataUrl) {
    try {
      const up = await ensureRemoverService();
      if (!up) return NextResponse.json({ error: "Inpaint service unreachable", message: "خدمة الإزالة المحلية غير متاحة" }, { status: 503 });
      const res = await localInpaint(
        body.sourcePath,
        body.maskDataUrl,
        Number.isFinite(body.growPx) ? Number(body.growPx) : 6,
        Number.isFinite(body.featherPx) ? Number(body.featherPx) : 4,
      );
      const buffer = Buffer.from(res.image_b64, "base64");
      const outName = `rm-obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const outPath = path.join(RESULTS_ROOT, outName);
      await fs.writeFile(outPath, buffer);
      await logEvent({ category: "tryon", message: `Object removed (mask inpaint, ${res.method}) in ${res.elapsedMs}ms` });
      return NextResponse.json({
        url: `/results/${outName}`, path: outPath, width: res.width, height: res.height,
        size: buffer.length, method: res.method, objectRemoved: "brush-mask",
      });
    } catch (e) {
      await logEvent({ category: "tryon", level: "error", message: "Mask inpaint failed", details: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: "Remove object failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
    }
  }

  // ------------------------------------------------------------------
  // AI MODE (no mask) — whole-image generative edit, kept for the
  // description-only flow ("ما الذي تريد إزالته؟").
  // ------------------------------------------------------------------
  const objectDescription = body.objectDescription ?? "an unwanted object";
  try {
    const prompt = `Remove ${objectDescription} from this photo. Fill the area naturally with the surrounding content — match colors, lighting, textures, and patterns. The result must look like the object was never there. DO NOT change anything else in the image. Keep the exact same framing and full field of view — do not crop or zoom.`;

    // Frame-locked: no backend center-crop, result returned at the source's
    // exact dimensions. edgeLock=false because a removed object may sit at
    // the border (its band legitimately changes).
    const result = await aiEditFrameLocked({ sourcePath: body.sourcePath, prompt, edgeLock: false });
    const buffer = result.buffer;
    const srcW = result.width, srcH = result.height;
    const outName = `rm-obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Object removed: ${objectDescription}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, method: "ai-remove-object", objectRemoved: objectDescription });
  } catch (e) { await logEvent({ category: "tryon", level: "error", message: "Remove object failed", details: e instanceof Error ? e.message : String(e) }); return NextResponse.json({ error: "Remove object failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
