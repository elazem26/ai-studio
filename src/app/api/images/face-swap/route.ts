import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath, resolveDataRoot } from "@/lib/security/resolve-file-path";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";
const MINI_SERVICE_SWAP = `${MINI_SERVICE_URL}/swap`;
const MINI_SERVICE_HEALTH = `${MINI_SERVICE_URL}/health`;

/** Detect the Python command based on platform */
function getPythonCmd(): string {
  if (process.platform === "win32") return "python";
  return "/home/z/.venv/bin/python3";
}

/** Get the project root (cross-platform) */
function getProjectRoot(): string {
  return process.cwd();
}

/** Get the service script path (cross-platform) */
function getServiceScript(): string {
  return path.join(getProjectRoot(), "mini-services", "face-swap-pro", "server.py");
}

async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(MINI_SERVICE_HEALTH, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

/** Spawn the face-swap service if it's not running */
async function spawnServiceIfDown(): Promise<boolean> {
  if (await isMiniServiceUp()) return true;
  try {
    const { spawn, execSync } = (typeof eval !== "undefined") ? eval("require")("child_process") : require("child_process");
    const PYTHON = getPythonCmd();
    const SCRIPT = getServiceScript();
    const CWD = getProjectRoot();

    // Try to spawn the service
    const proc = spawn(PYTHON, [SCRIPT], {
      cwd: CWD,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    proc.unref();

    // Wait up to 15s for it to come up
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isMiniServiceUp()) return true;
    }
    return false;
  } catch { return false; }
}

/**
 * POST — wrapped with the global processing lock to serialize heavy
 * operations and avoid the platform's ResourceExhausted error.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("face-swap")) {
    const status = getProcessingStatus();
    return NextResponse.json({
      error: `عملية "${status.op}" جارية الآن (${Math.round(status.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`,
      retryAfter: 5,
      busyWith: status.op,
    }, { status: 429 });
  }
  try {
    return await _POST_impl(req);
  } finally {
    releaseProcessingLock();
  }
}

async function _POST_impl(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath || !body.facePath) {
    return NextResponse.json({ error: "Missing sourcePath or facePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
    body.facePath = await resolveFilePath(body.facePath);
  } catch (e: any) {
    return NextResponse.json({ error: "File not found", message: e?.message }, { status: 404 });
  }

  const resultsRoot = path.resolve(await resolveDataRoot(), "results");
  await fs.mkdir(resultsRoot, { recursive: true });

  try {
    const srcBuf = await fs.readFile(body.sourcePath);
    const faceBuf = await fs.readFile(body.facePath);
    const srcMeta = await sharp(srcBuf).metadata();
    const srcW = srcMeta.width ?? 0;
    const srcH = srcMeta.height ?? 0;

    // Auto-start the service if down
    const up = await spawnServiceIfDown();
    if (!up) {
      const isWin = process.platform === "win32";
      return NextResponse.json({
        error: "Face-swap service unavailable",
        message: isWin
          ? "The face-swap Python service could not be started. Please run 'install-deps.bat' first to install Python dependencies (insightface, onnxruntime), then restart AI Studio."
          : "The face-swap service could not be started. Please try again in a few seconds.",
        retry: true,
      }, { status: 503 });
    }

    // Call the local mini-service.
    // Optional face selection: sourceIndex / faceIndex (0 = largest face)
    // or a full mappings list [{ sourceIndex, faceIndex }] for multi-merge
    // (e.g. reference face ① → source face ② AND reference ② → source ①).
    const srcPng = await sharp(srcBuf).png().toBuffer();
    const facePng = await sharp(faceBuf).png().toBuffer();
    const srcB64 = srcPng.toString("base64");
    const faceB64 = facePng.toString("base64");

    const swapPayload: Record<string, unknown> = {
      source: `data:image/png;base64,${srcB64}`,
      face: `data:image/png;base64,${faceB64}`,
    };
    const rawMappings = Array.isArray(body.mappings) ? body.mappings : null;
    if (rawMappings) {
      const clean = rawMappings
        .filter((m: any) => m && Number.isInteger(Number(m.sourceIndex)) && Number.isInteger(Number(m.faceIndex)))
        .slice(0, 20)
        .map((m: any) => ({ sourceIndex: Number(m.sourceIndex), faceIndex: Number(m.faceIndex) }));
      if (clean.length) swapPayload.mappings = clean;
    } else {
      if (Number.isInteger(Number(body.sourceIndex))) swapPayload.sourceIndex = Number(body.sourceIndex);
      if (Number.isInteger(Number(body.faceIndex))) swapPayload.faceIndex = Number(body.faceIndex);
    }

    const res = await fetch(MINI_SERVICE_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapPayload),
      signal: AbortSignal.timeout(120_000), // multi-merge needs more time
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errBody: any = {};
      try { errBody = errText ? JSON.parse(errText) : {}; } catch {}
      return NextResponse.json({
        error: errBody.error || `Face-swap service error (HTTP ${res.status})`,
        message: errBody.error || errText.slice(0, 200),
      }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return NextResponse.json({
        error: data?.error || "Face-swap service returned no result",
      }, { status: 500 });
    }

    const b64 = String(data.result).split(",", 2)[1] ?? "";
    let resultBuf = Buffer.from(b64, "base64");

    if (resultBuf.length < 1000) {
      return NextResponse.json({
        error: "Face-swap produced an invalid result (too small)",
      }, { status: 500 });
    }

    // Resize back to source dimensions if needed
    if (srcW && srcH) {
      const m = await sharp(resultBuf).metadata();
      if (m.width !== srcW || m.height !== srcH) {
        resultBuf = Buffer.from(
          await sharp(resultBuf)
            .resize(srcW, srcH, { kernel: "lanczos3", fit: "fill" })
            .png({ quality: 95 })
            .toBuffer()
        );
      }
    }

    const out = `face-swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(resultsRoot, out);
    await fs.writeFile(outPath, resultBuf);
    const fm = await sharp(resultBuf).metadata();

    await logEvent({
      level: "info",
      category: "agents",
      message: "Face swap completed",
      details: JSON.stringify({
        method: "insightface-inswapper-128-local",
        width: fm.width ?? srcW,
        height: fm.height ?? srcH,
      }),
    }).catch(() => {});

    return NextResponse.json({
      url: `/results/${out}`,
      path: outPath,
      width: fm.width ?? srcW,
      height: fm.height ?? srcH,
      size: resultBuf.length,
      method: "insightface-inswapper-128-local",
    });
  } catch (e) {
    await logEvent({
      level: "error",
      category: "agents",
      message: `Face swap failed: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Face swap failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** GET /api/images/face-swap — returns service health */
export async function GET() {
  try {
    const r = await fetch(MINI_SERVICE_HEALTH, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const data = await r.json();
      return NextResponse.json({ healthy: true, ...data });
    }
    return NextResponse.json({ healthy: false, status: r.status }, { status: 503 });
  } catch (e) {
    return NextResponse.json({
      healthy: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 503 });
  }
}
