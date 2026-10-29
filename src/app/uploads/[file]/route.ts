import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveDataRoot } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".json": "application/json",
  ".txt": "text/plain",
};

/**
 * GET /uploads/[file] — serve an uploaded file from data/uploads/.
 * Used by the UI to display images that were just uploaded.
 *
 * Security: only the basename is used (no path traversal).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  try {
    const { file } = await params;
    // SECURITY: only allow basename — block any path traversal
    const safeName = path.basename(file);
    if (!safeName || safeName !== file || safeName.includes("..")) {
      return NextResponse.json({ ok: false, error: "Invalid filename" }, { status: 400 });
    }
    // Only allow known file extensions
    const ext = path.extname(safeName).toLowerCase();
    if (!ext || !MIME[ext]) {
      return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    }

    const root = await resolveDataRoot();
    const target = path.join(root, "uploads", safeName);
    // Resolve and verify it's still inside data/uploads/
    const normalizedTarget = path.resolve(target);
    const uploadsRoot = path.resolve(path.join(root, "uploads"));
    if (!normalizedTarget.startsWith(uploadsRoot + path.sep)) {
      return NextResponse.json({ ok: false, error: "Path traversal" }, { status: 400 });
    }

    try {
      const buf = await fs.readFile(target);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": MIME[ext],
          "Cache-Control": "public, max-age=3600, must-revalidate",
          "Content-Length": String(buf.length),
        },
      });
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
      }
      throw e;
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
