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
const TRANSPLANT_URL = `${MINI_SERVICE_URL}/transplant`;

/**
 * POST /api/images/transplant — نقل أي جزء (رأس/جسم/حيوان/خلفية) من صورة
 * مرجعية إلى الصورة الأساس مع مطابقة الحجم ولون البشرة والإضاءة.
 *
 * Body: { sourcePath, refPath, mask?, cx?, cy?, w?, rotate?, flip?,
 *         colorMatch?, blend?, feather?, auto? }
 * mask = data URL PNG (بحجم صورة المرجع) من فرشاة الواجهة.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("transplant")) {
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
  let sourcePath: string;
  let refPath: string;
  try {
    sourcePath = await resolveFilePath(body.sourcePath);
    refPath = await resolveFilePath(body.refPath);
  } catch (e: any) {
    return NextResponse.json({ error: "File not found", message: e?.message }, { status: 404 });
  }

  const resultsRoot = path.resolve(await resolveDataRoot(), "results");
  await fs.mkdir(resultsRoot, { recursive: true });

  try {
    const srcBuf = await fs.readFile(sourcePath);
    const refBuf = await fs.readFile(refPath);
    const srcMeta = await sharp(srcBuf).metadata();
    const srcW = srcMeta.width ?? 0;
    const srcH = srcMeta.height ?? 0;

    const payload: Record<string, unknown> = {
      source: `data:image/png;base64,${(await sharp(srcBuf).png().toBuffer()).toString("base64")}`,
      reference: `data:image/png;base64,${(await sharp(refBuf).png().toBuffer()).toString("base64")}`,
      auto: Boolean(body.auto),
    };
    if (body.mask && typeof body.mask === "string" && body.mask.startsWith("data:")) {
      payload.mask = body.mask;
    }
    for (const k of ["cx", "cy", "w", "rotate", "flip", "colorMatch", "blend", "feather"] as const) {
      if (body[k] !== undefined && body[k] !== null) payload[k] = body[k];
    }

    const res = await fetch(TRANSPLANT_URL, {
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
        downloading: Boolean(errBody.downloading),
        progress: Number(errBody.progress ?? 0),
      }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return NextResponse.json({ error: data?.error || "Transplant service returned no result" }, { status: 500 });
    }

    const b64 = String(data.result).split(",", 2)[1] ?? "";
    let resultBuf = Buffer.from(b64, "base64");
    if (resultBuf.length < 1000) {
      return NextResponse.json({ error: "Transplant produced an invalid result (too small)" }, { status: 500 });
    }

    // Resize back to the original source dimensions if the service downscaled
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

    const out = `transplant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(resultsRoot, out);
    await fs.writeFile(outPath, resultBuf);
    const fm = await sharp(resultBuf).metadata();

    await logEvent({
      level: "info",
      category: "agents",
      message: "Part transplant completed",
      details: JSON.stringify({ method: "opencv-seamless-clone+lab-harmonize", auto: Boolean(body.auto) }),
    }).catch(() => {});

    return NextResponse.json({
      url: `/results/${out}`,
      path: outPath,
      width: fm.width ?? srcW,
      height: fm.height ?? srcH,
      size: resultBuf.length,
      info: data.info ?? null,
    });
  } catch (e) {
    await logEvent({
      level: "error",
      category: "agents",
      message: `Part transplant failed: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Part transplant failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
