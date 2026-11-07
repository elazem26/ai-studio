import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * POST /api/voice/asr — تحويل الصوت المسجل إلى نص
 * body: { audioBase64, mime? }  →  { text }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const audioBase64 = (body.audioBase64 ?? "").toString();
    if (!audioBase64) return NextResponse.json({ error: "Missing audioBase64" }, { status: 400 });

    const raw = audioBase64.includes(",") ? audioBase64.slice(audioBase64.indexOf(",") + 1) : audioBase64;
    const approx = (raw.length * 3) / 4;
    if (approx <= 0) return NextResponse.json({ error: "Empty audio" }, { status: 400 });
    if (approx > MAX_BYTES) return NextResponse.json({ error: "Audio too large (max 20MB)" }, { status: 413 });

    const Z = (await import("z-ai-web-dev-sdk")).default;
    const zai = await Z.create();
    const response = await zai.audio.asr.create({ file_base64: raw });
    const text = (response?.text ?? "").toString().trim();
    if (!text) return NextResponse.json({ error: "لم يتم التعرف على أي كلام — أعد التسجيل" }, { status: 422 });

    return NextResponse.json({ text });
  } catch (e) {
    await logEvent({ category: "system", level: "error", message: "ASR failed", details: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: e instanceof Error ? e.message : "ASR failed" }, { status: 500 });
  }
}
