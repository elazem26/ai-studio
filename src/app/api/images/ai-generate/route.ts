import { NextRequest, NextResponse } from "next/server";
import { generateImageUrl, generateImageBase64, POLLINATIONS_MODELS } from "@/lib/ai/pollinations";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — list available Pollinations models */
export async function GET() {
  return NextResponse.json({ models: POLLINATIONS_MODELS });
}

/** POST — generate an image via Pollinations.ai (free, no API key) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, width, height, seed, model, negative, format = "url" } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt مطلوب" }, { status: 400 });
    }

    await logEvent({
      category: "system",
      message: `Pollinations image gen: "${prompt.slice(0, 80)}"`,
    });

    if (format === "base64") {
      const result = await generateImageBase64({
        prompt, width, height, seed, model, negative,
      });
      return NextResponse.json({
        ok: true,
        dataUrl: result.dataUrl,
        url: result.url,
        size: result.size,
        provider: "pollinations",
      });
    }

    // Default: return URL only (client can fetch the image directly)
    const url = generateImageUrl({
      prompt, width, height, seed, model, negative,
    });

    return NextResponse.json({
      ok: true,
      url,
      provider: "pollinations",
      prompt,
      width: width || 1024,
      height: height || 1024,
      model: model || "flux",
    });
  } catch (e: any) {
    await logEvent({
      category: "system", level: "error",
      message: "Pollinations image gen failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: e?.message || "خطأ في إنشاء الصورة" }, { status: 500 });
  }
}
