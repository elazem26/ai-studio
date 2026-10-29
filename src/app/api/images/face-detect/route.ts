import { NextRequest, NextResponse } from "next/server";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { readForDetect } from "@/lib/detect-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";

/** Same auto-start logic as the face-swap route (shared service). */
async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${MINI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function spawnServiceIfDown(): Promise<boolean> {
  if (await isMiniServiceUp()) return true;
  try {
    const { spawn } = (typeof eval !== "undefined") ? eval("require")("child_process") : require("child_process");
    const proc = spawn("/home/z/.venv/bin/python3", [`${process.cwd()}/mini-services/face-swap-pro/server.py`], {
      cwd: process.cwd(),
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

/**
 * POST /api/images/face-detect
 * Body: { imagePath: "/uploads/xxx.png" | absolute path | data URL, mode?: "faces" | "persons" }
 *   mode "faces"   (default) → numbered FACE boxes
 *   mode "persons"           → face-anchored TORSO boxes (for clothing swap)
 * Returns numbered boxes (normalized 0..1) for UI overlay.
 *
 * Faces are ordered largest-first by the Python service, so index 0
 * always means "الأكبر". The SAME ordering is used by /swap, which makes
 * the numbering consistent between detection and the actual swap.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const imageInput: string | undefined = body.imagePath || body.image || body.url;
  const mode: string = body.mode === "persons" ? "persons" : "faces";
  if (!imageInput) {
    return NextResponse.json({ error: "Missing imagePath" }, { status: 400 });
  }

  try {
    let resolved = imageInput;
    if (!imageInput.startsWith("data:")) {
      try {
        const filePath = await resolveFilePath(imageInput);
        // DOWNSCALE before detection: huge uploads (10-25MB) used to take
        // seconds to decode/transfer. Bboxes are normalized 0..1 so the
        // returned coordinates are IDENTICAL — just much faster.
        resolved = await readForDetect(filePath);
      } catch {
        return NextResponse.json({ error: "File not found", message: `تعذر الوصول إلى: ${imageInput}` }, { status: 404 });
      }
    }

    const up = await spawnServiceIfDown();
    if (!up) {
      return NextResponse.json({
        error: "Face-detect service unavailable",
        message: "خدمة كشف الوجوه غير متاحة حالياً — أعد المحاولة بعد لحظات.",
        retry: true,
      }, { status: 503 });
    }

    const res = await fetch(`${MINI_SERVICE_URL}/${mode === "persons" ? "detect-persons" : "detect"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: resolved }),
      signal: AbortSignal.timeout(60_000), // first call loads the model
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errBody: any = {};
      try { errBody = errText ? JSON.parse(errText) : {}; } catch {}
      return NextResponse.json({
        error: errBody.error || `Face-detect error (HTTP ${res.status})`,
        message: errBody.error || errText.slice(0, 200),
      }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok) {
      return NextResponse.json({ error: data?.error || "Detection failed" }, { status: 500 });
    }

    const items: any[] = data.faces ?? data.persons ?? [];
    return NextResponse.json({
      ok: true,
      mode,
      width: data.width,
      height: data.height,
      count: items.length,
      faces: mode === "persons" ? [] : items,
      persons: mode === "persons" ? items : [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Face detection failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
