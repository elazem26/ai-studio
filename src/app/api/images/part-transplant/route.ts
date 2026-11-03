import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath, resolveDataRoot } from "@/lib/security/resolve-file-path";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";
import { findMiniServiceScript, miniServiceRoot } from "@/lib/mini-service";
import { getPythonBin, spawnSafe } from "@/lib/python-bin";

/**
 * POST /api/images/part-transplant — نقل جزء من صورة مرجعية إلى الصورة المصدر
 * (رأس / جسم كامل / كائن أو حيوان / خلفية) مع دمج واقعي:
 * ضبط تلقائي للحجم + توحيد لون البشرة والإضاءة + دمج بواسوني.
 *
 * Follows the exact face-swap pattern: Next route resolves server paths,
 * proxies base64 data URLs to the python mini-service (:3030/transplant),
 * decodes the result, normalizes size and saves it under /results.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";
const MINI_SERVICE_TRANSPLANT = `${MINI_SERVICE_URL}/transplant`;
const MINI_SERVICE_HEALTH = `${MINI_SERVICE_URL}/health`;

function getPythonCmd(): string {
  return getPythonBin();
}

function getProjectRoot(): string {
  return miniServiceRoot();
}

function getServiceScript(): string {
  return findMiniServiceScript();
}

async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(MINI_SERVICE_HEALTH, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

/** Spawn the face-swap service if it's not running (same as face-swap route) */
async function spawnServiceIfDown(): Promise<boolean> {
  if (await isMiniServiceUp()) return true;
  try {
    const { spawn } = (typeof eval !== "undefined") ? eval("require")("child_process") : require("child_process");
    const proc = spawnSafe(getPythonBin(), [getServiceScript()], {
      cwd: getProjectRoot(),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    proc.unref();
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isMiniServiceUp()) return true;
    }
    return false;
  } catch { return false; }
}

const VALID_MODES = ["head", "person", "object", "background", "custom"] as const;

export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("part-transplant")) {
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
  if (!body.sourcePath || !body.refPath) {
    return NextResponse.json({ error: "Missing sourcePath or refPath" }, { status: 400 });
  }
  const mode = String(body.mode || "head").toLowerCase();
  if (!(VALID_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: `نمط غير معروف: ${mode}` }, { status: 400 });
  }

  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
    body.refPath = await resolveFilePath(body.refPath);
  } catch (e: any) {
    return NextResponse.json({ error: "File not found", message: e?.message }, { status: 404 });
  }

  const resultsRoot = path.resolve(await resolveDataRoot(), "results");
  await fs.mkdir(resultsRoot, { recursive: true });

  try {
    const srcBuf = await fs.readFile(body.sourcePath);
    const refBuf = await fs.readFile(body.refPath);
    const srcMeta = await sharp(srcBuf).metadata();
    const srcW = srcMeta.width ?? 0;
    const srcH = srcMeta.height ?? 0;

    const up = await spawnServiceIfDown();
    if (!up) {
      return NextResponse.json({
        error: "خدمة المعالجة غير متاحة",
        message: "لم تبدأ خدمة الذكاء الاصطناعي. حاول مجدداً بعد ثوانٍ.",
        retry: true,
      }, { status: 503 });
    }

    const srcPng = await sharp(srcBuf).png().toBuffer();
    const refPng = await sharp(refBuf).png().toBuffer();

    const payload: Record<string, unknown> = {
      source: `data:image/png;base64,${srcPng.toString("base64")}`,
      ref: `data:image/png;base64,${refPng.toString("base64")}`,
      mode,
    };
    if (Number.isInteger(Number(body.sourceIndex))) payload.sourceIndex = Number(body.sourceIndex);
    if (Number.isInteger(Number(body.faceIndex))) payload.faceIndex = Number(body.faceIndex);
    const region = String(body.region || "full").toLowerCase();
    if (["full", "hair", "face", "chest", "torso", "arms", "legs"].includes(region)) {
      payload.region = region;
    }
    const scale = Number(body.scale);
    if (Number.isFinite(scale) && scale > 0) payload.scale = Math.min(3, Math.max(0.2, scale));
    const cs = Number(body.colorStrength);
    if (Number.isFinite(cs)) payload.colorStrength = Math.min(1, Math.max(0, cs));
    if (body.targetBox && typeof body.targetBox === "object") {
      const tb = body.targetBox;
      const nums = ["x", "y", "w", "h"].map(k => Number(tb[k]));
      if (nums.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
        payload.targetBox = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
      }
    }
    // custom mode: التحديد المعتمد من وكيل الدردشة (قناع + مواصفات)
    if (mode === "custom") {
      if (typeof body.refMask === "string" && body.refMask.startsWith("data:image")) payload.refMask = body.refMask;
      if (body.refSpec && typeof body.refSpec === "object") payload.refSpec = body.refSpec;
      if (body.srcSpec && typeof body.srcSpec === "object") payload.srcSpec = body.srcSpec;
      if (Array.isArray(body.placeBox) && body.placeBox.length >= 4 &&
          body.placeBox.every((n: unknown) => Number.isFinite(Number(n)))) {
        payload.placeBox = body.placeBox.map(Number);
      }
      if (typeof body.erase === "boolean") payload.erase = body.erase;
      if (typeof body.edited === "boolean") payload.edited = body.edited;
    }

    const res = await fetch(MINI_SERVICE_TRANSPLANT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errBody: any = {};
      try { errBody = errText ? JSON.parse(errText) : {}; } catch {}
      return NextResponse.json({
        error: errBody.error || `Transplant service error (HTTP ${res.status})`,
        message: errBody.error || errText.slice(0, 200),
      }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return NextResponse.json({
        error: data?.error || "Transplant service returned no result",
      }, { status: 500 });
    }

    let resultBuf = Buffer.from(String(data.result).split(",", 2)[1] ?? "", "base64");
    if (resultBuf.length < 1000) {
      return NextResponse.json({ error: "Transplant produced an invalid result (too small)" }, { status: 500 });
    }

    // Background mode outputs at the REFERENCE size — keep it; other modes
    // output at the SOURCE size (the service already restores dimensions,
    // this is just a safety net).
    if (mode !== "background" && srcW && srcH) {
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

    const out = `part-transplant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(resultsRoot, out);
    await fs.writeFile(outPath, resultBuf);
    const fm = await sharp(resultBuf).metadata();

    await logEvent({
      level: "info",
      category: "agents",
      message: "Part transplant completed",
      details: JSON.stringify({ mode, width: fm.width, height: fm.height }),
    }).catch(() => {});

    return NextResponse.json({
      url: `/results/${out}`,
      path: outPath,
      width: fm.width,
      height: fm.height,
      size: resultBuf.length,
      mode,
      method: "grabcut-poisson-lab",
    });
  } catch (e) {
    await logEvent({
      level: "error",
      category: "agents",
      message: `Part transplant failed: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
    return NextResponse.json(
      { error: "نقل الجزء فشل", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** GET — service health passthrough */
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
