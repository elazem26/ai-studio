import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
const MINI_SERVICE_SWAP = "http://localhost:3030/swap";

/** POST /api/proxy/swap — multipart face-swap, returns binary PNG */
export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const sourceFile = fd.get("source") as File | null;
    const faceFile = fd.get("face") as File | null;
    if (!sourceFile || !faceFile) {
      return new NextResponse(JSON.stringify({ error: "Missing source or face file" }),
        { status: 400, headers: { "Content-Type": "application/json" } });
    }

    await fs.mkdir(RESULTS_ROOT, { recursive: true });
    const srcBuf = Buffer.from(await sourceFile.arrayBuffer());
    const faceBuf = Buffer.from(await faceFile.arrayBuffer());
    const srcPng = await sharp(srcBuf).png().toBuffer();
    const facePng = await sharp(faceBuf).png().toBuffer();

    const res = await fetch(MINI_SERVICE_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: `data:image/png;base64,${srcPng.toString("base64")}`,
        face: `data:image/png;base64,${facePng.toString("base64")}`,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return new NextResponse(txt || JSON.stringify({ error: `HTTP ${res.status}` }),
        { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    const data: any = await res.json();
    if (!data?.ok || !data.result) {
      return new NextResponse(JSON.stringify({ error: data?.error || "No result" }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const b64 = String(data.result).split(",", 2)[1] ?? "";
    const resultBuf = Buffer.from(b64, "base64");
    const outName = `face-swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, resultBuf);

    return new NextResponse(new Uint8Array(resultBuf), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(resultBuf.length),
        "Cache-Control": "no-store",
        "X-Result-Path": outPath,
        "X-Result-Url": `/results/${outName}`,
        "X-Method": "insightface-inswapper-128-local",
      },
    });
  } catch (e) {
    return new NextResponse(JSON.stringify({ error: "Face swap failed", message: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
