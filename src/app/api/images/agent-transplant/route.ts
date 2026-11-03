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
const AGENT_URL = `${MINI_SERVICE_URL}/agent-transplant`;

/**
 * POST /api/images/agent-transplant — الوكيل الذكي: ينفّذ أمر نقل كاملاً
 * من جملة عربية ("انقل الرأس") دون أي تدخل من المستخدم.
 *
 * Body: { sourcePath, refPath, command, colorMatch?, blend?, feather? }
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("agent-transplant")) {
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
  if (!body.sourcePath || !body.refPath || !body.command) {
    return NextResponse.json({ error: "Missing sourcePath, refPath or command" }, { status: 400 });
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
      command: String(body.command).slice(0, 300),
    };
    for (const k of ["colorMatch", "blend", "feather"] as const) {
      if (body[k] !== undefined && body[k] !== null) payload[k] = body[k];
    }

    const res = await fetch(AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(150_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errBody: any = {};
      try { errBody = errText ? JSON.parse(errText) : {}; } catch {}
      return NextResponse.json({
        error: errBody.error || `Agent transplant service error (HTTP ${res.status})`,
        message: errBody.error || errText.slice(0, 200),
        downloading: Boolean(errBody.downloading),
        progress: Number(errBody.progress ?? 0),
        stages: Array.isArray(errBody.stages) ? errBody.stages : [],
      }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return NextResponse.json({ error: data?.error || "Agent transplant returned no result" }, { status: 500 });
    }

    const b64 = String(data.result).split(",", 2)[1] ?? "";
    let resultBuf = Buffer.from(b64, "base64");
    if (resultBuf.length < 1000) {
      return NextResponse.json({ error: "Agent transplant produced an invalid result" }, { status: 500 });
    }

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

    const out = `agent-transplant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(resultsRoot, out);
    await fs.writeFile(outPath, resultBuf);
    const fm = await sharp(resultBuf).metadata();

    await logEvent({
      level: "info",
      category: "agents",
      message: "Agent transplant completed",
      details: JSON.stringify({ part: data.part ?? "?", command: String(body.command).slice(0, 80) }),
    }).catch(() => {});

    return NextResponse.json({
      url: `/results/${out}`,
      path: outPath,
      width: fm.width ?? srcW,
      height: fm.height ?? srcH,
      part: data.part ?? null,
      steps: Array.isArray(data.steps) ? data.steps : [],
      stages: Array.isArray(data.stages) ? data.stages : [],
      info: data.info ?? null,
    });
  } catch (e) {
    await logEvent({
      level: "error",
      category: "agents",
      message: `Agent transplant failed: ${e instanceof Error ? e.message : String(e)}`,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Agent transplant failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
