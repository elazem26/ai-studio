import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
const MINI_SERVICE_SWAP = "http://localhost:3030/swap";

/** POST /api/proxy/swap-multi — returns JSON { results: [url1, url2, url3] } */
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const sourceFile = fd.get("source") as File | null;
    const faceFile = fd.get("face") as File | null;
    if (!sourceFile || !faceFile) {
      return NextResponse.json({ error: "Missing source or face file" }, { status: 400 });
    }

    await fs.mkdir(RESULTS_ROOT, { recursive: true });
    const srcBuf = Buffer.from(await sourceFile.arrayBuffer());
    const faceBuf = Buffer.from(await faceFile.arrayBuffer());
    const srcPng = await sharp(srcBuf).png().toBuffer();
    const facePng = await sharp(faceBuf).png().toBuffer();
    const srcB64 = srcPng.toString("base64");
    const faceB64 = facePng.toString("base64");

    // inswapper is deterministic — run once and save 3 copies
    const res = await fetch(MINI_SERVICE_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: `data:image/png;base64,${srcB64}`,
        face: `data:image/png;base64,${faceB64}`,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json({ error: txt || `HTTP ${res.status}` }, { status: res.status });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return NextResponse.json({ error: data?.error || "No result" }, { status: 500 });
    }

    const b64 = String(data.result).split(",", 2)[1] ?? "";
    const buf = Buffer.from(b64, "base64");
    const localUrls: string[] = [];
    for (let i = 0; i < 3; i++) {
      const outName = `face-swap-multi-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.png`;
      await fs.writeFile(path.join(RESULTS_ROOT, outName), buf);
      localUrls.push(`/results/${outName}`);
    }
    return NextResponse.json({ results: localUrls });
  } catch (e) {
    return NextResponse.json({ error: "Multi face swap failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
