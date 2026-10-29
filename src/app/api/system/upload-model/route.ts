import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_PATH = "/home/z/my-project/mini-services/face-swap-pro/models/inswapper_128.onnx";
const MODEL_DIR = path.dirname(MODEL_PATH);
const EXPECTED_MIN_SIZE = 100 * 1024 * 1024; // at least 100 MB
const EXPECTED_MAX_SIZE = 700 * 1024 * 1024; // at most 700 MB

/** GET — report current state of the model file. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const stat = await fs.stat(MODEL_PATH).catch(() => null);
    return NextResponse.json({
      ok: true,
      exists: !!stat,
      sizeBytes: stat?.size ?? 0,
      sizeMB: stat ? Math.round(stat.size / 1024 / 1024) : 0,
      path: MODEL_PATH,
      expectedMinMB: Math.round(EXPECTED_MIN_SIZE / 1024 / 1024),
      expectedMaxMB: Math.round(EXPECTED_MAX_SIZE / 1024 / 1024),
      valid: stat ? stat.size >= EXPECTED_MIN_SIZE && stat.size <= EXPECTED_MAX_SIZE : false,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

/** POST — accept the uploaded model file and write it to the model path. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    await fs.mkdir(MODEL_DIR, { recursive: true });

    const ct = req.headers.get("content-type") || "";
    let buf: Buffer;

    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = (fd.get("file") || fd.get("model")) as File | null;
      if (!f) {
        return NextResponse.json(
          { ok: false, error: "No file uploaded. Use field name 'file' or 'model'." },
          { status: 400 }
        );
      }
      buf = Buffer.from(await f.arrayBuffer());
    } else {
      // Raw body upload (file bytes directly)
      buf = Buffer.from(await req.arrayBuffer());
    }

    if (!buf.length) {
      return NextResponse.json({ ok: false, error: "Empty file received" }, { status: 400 });
    }

    if (buf.length < EXPECTED_MIN_SIZE) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too small (${Math.round(buf.length / 1024 / 1024)} MB). Expected 100-700 MB. The inswapper_128.onnx model is typically ~555 MB.`,
        },
        { status: 413 }
      );
    }
    if (buf.length > EXPECTED_MAX_SIZE) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too large (${Math.round(buf.length / 1024 / 1024)} MB). Expected 100-700 MB.`,
        },
        { status: 413 }
      );
    }

    // Sanity checks — reject obvious wrong file types
    const isZip = buf.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (isZip) {
      return NextResponse.json(
        { ok: false, error: "Uploaded file looks like a ZIP. Please upload the raw .onnx file (extract the zip first)." },
        { status: 400 }
      );
    }
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (isPng) {
      return NextResponse.json(
        { ok: false, error: "Uploaded file looks like a PNG, not an ONNX model." },
        { status: 400 }
      );
    }

    await fs.writeFile(MODEL_PATH, buf);

    return NextResponse.json({
      ok: true,
      message: "Model saved successfully",
      path: MODEL_PATH,
      sizeBytes: buf.length,
      sizeMB: Math.round(buf.length / 1024 / 1024),
      nextStep: "Restart the face-swap-pro service to load the new model.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

/** DELETE — remove the model file (useful for re-uploading). */
export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });
  try {
    await fs.unlink(MODEL_PATH).catch(() => {});
    return NextResponse.json({ ok: true, message: "Model file deleted" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}