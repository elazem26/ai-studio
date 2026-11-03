import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { requireAdmin } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SCRIPT = "/home/z/my-project/extracted/scripts/encrypted-backup.sh";
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });
 return NextResponse.json({ ok: true, endpoint: "/api/system/create-backup" }); }
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    await fs.chmod(SCRIPT, 0o755).catch(() => {});
    const child = execFile("bash", [SCRIPT], { cwd: "/home/z/my-project", timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    await new Promise<void>((r) => { child.on("close", () => r()); child.on("error", () => r()); });
    const dir = "/home/z/my-project/backups";
    let latest: any = null;
    try { for (const f of await fs.readdir(dir)) { if (f.endsWith(".tar.gz")) { const st = await fs.stat(path.join(dir, f)); if (!latest || st.mtimeMs > latest.mtime) latest = { filename: f, size: st.size }; } } } catch {}
    return NextResponse.json({ ok: true, backup: latest, stdout: stdout.slice(-300) });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 500 }); }
}