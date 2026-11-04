import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveDataRoot } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — matches the UI hint
const FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  tiff: { mime: "image/tiff", ext: "tiff" },
  gif: { mime: "image/gif", ext: "gif" },
  bmp: { mime: "image/bmp", ext: "bmp" },
};

/**
 * POST /api/images/upload — receive an image via multipart FormData("file"),
 * validate it as a REAL image (sharp metadata — never trust client mime),
 * store it under data/uploads/ and return an UploadedImage object that the
 * UI (zustand image-store) stores directly.
 *
 * Recreated 2026-10-29: the original route file had gone missing from the
 * tree, so every upload attempt hit a 404 ("خطاء في رفع الصور").
 *
 * Security:
 *  - filename is generated server-side (no user input ever touches the FS)
 *  - type is sniffed from the decoded image itself
 *  - hard 25MB cap
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "errors.invalidImage" }, { status: 400 });
    }
    const blob = file as File;
    if (blob.size <= 0) {
      return NextResponse.json({ error: "errors.invalidImage" }, { status: 400 });
    }
    if (blob.size > MAX_BYTES) {
      return NextResponse.json({ error: "errors.invalidImage" }, { status: 413 });
    }

    const buf = Buffer.from(await blob.arrayBuffer());

    // Real image validation + dimensions (throws if not a decodable image)
    let meta;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      return NextResponse.json({ error: "errors.invalidImage" }, { status: 400 });
    }
    const fmt = FORMATS[(meta.format || "").toLowerCase()];
    if (!fmt) {
      return NextResponse.json({ error: "errors.invalidImage" }, { status: 415 });
    }

    // Store under data/uploads/ (created on demand — survives fresh clones)
    const root = await resolveDataRoot();
    const uploadsDir = path.join(root, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const id = crypto.randomUUID();
    const fileName = `${Date.now().toString(36)}-${crypto
      .randomBytes(6)
      .toString("hex")}.${fmt.ext}`;
    await fs.writeFile(path.join(uploadsDir, fileName), buf);

    // Keep a filesystem-safe original name for display only
    const original = (blob.name || "image").replace(/[\\/\r\n\0]/g, "_").slice(0, 120);

    await logEvent({
      category: "tryon",
      message: `Upload: ${original} → ${fileName} (${meta.width}x${meta.height} ${meta.format}, ${buf.length}B)`,
    });

    return NextResponse.json({
      id,
      name: original,
      path: `data/uploads/${fileName}`,
      url: `/uploads/${fileName}`,
      mime: fmt.mime,
      size: buf.length,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: (meta.format || "").toLowerCase(),
      uploadedAt: Date.now(),
    });
  } catch (e) {
    await logEvent({
      category: "tryon",
      level: "error",
      message: "Upload failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "errors.unknown", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
