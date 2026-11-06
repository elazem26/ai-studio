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

    // الجذر الدائم أولاً ثم الجذور القديمة (صور رُفعت قبل توحيد الجذر)
    const roots = [
      await resolveDataRoot(),
      "/home/z/my-project/.next/standalone/data",
      path.join(process.cwd(), "data"),
    ];
    const uploadsRoots = roots.map((r) => path.resolve(path.join(r, "uploads")));
    let buf: Buffer | null = null;
    for (let i = 0; i < roots.length; i++) {
      const target = path.resolve(path.join(roots[i], "uploads", safeName));
      // SECURITY: verify it's still inside that root (no path traversal)
      if (!target.startsWith(uploadsRoots[i] + path.sep)) continue;
      try {
        buf = await fs.readFile(target);
        break;
      } catch (e: any) {
        if (e?.code !== "ENOENT") throw e;
      }
    }

    if (!buf) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": MIME[ext],
        "Cache-Control": "public, max-age=3600, must-revalidate",
        "Content-Length": String(buf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
