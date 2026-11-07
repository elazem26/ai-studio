import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 1000; // حد الـ API هو 1024 — نترك هامشًا

/**
 * POST /api/voice/tts — تحويل نص الوكيل إلى صوت (WAV)
 * body: { text, voice?, speed? }  →  audio/wav binary
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = (body.text ?? "").toString().replace(/\s+/g, " ").trim();
    if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

    const voice = typeof body.voice === "string" && body.voice ? body.voice : "tongtong";
    let speed = Number(body.speed);
    if (!Number.isFinite(speed) || speed <= 0) speed = 1.0;
    speed = Math.min(2.0, Math.max(0.5, speed));

    const chunks: string[] = [];
    if (text.length <= MAX) {
      chunks.push(text);
    } else {
      // تقسيم على حدود الجُمل لتجنب قطع الكلمات
      const sentences = text.split(/(?<=[.!?؟،؛\n])/);
      let cur = "";
      for (const s of sentences) {
        if ((cur + s).length <= MAX) cur += s;
        else {
          if (cur.trim()) chunks.push(cur.trim());
          cur = s.slice(0, MAX);
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
    }
    const first = chunks[0] ?? text.slice(0, MAX);

    const Z = (await import("z-ai-web-dev-sdk")).default;
    const zai = await Z.create();
    const response = await zai.audio.tts.create({
      input: first,
      voice,
      speed,
      response_format: "wav",
      stream: false,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    if (buffer.length < 100) throw new Error("Empty TTS output");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-cache",
        "X-Chunks-Total": String(chunks.length),
      },
    });
  } catch (e) {
    await logEvent({ category: "system", level: "error", message: "TTS failed", details: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: e instanceof Error ? e.message : "TTS failed" }, { status: 500 });
  }
}
