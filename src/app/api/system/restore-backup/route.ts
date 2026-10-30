import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { requireAdmin } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SCRIPT = "/home/z/my-project/extracted/scripts/auto-restore.sh";
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const dirs = ["/home/z/my-project/extracted/backups", "/home/z/my-project/extracted/scripts/safe-restore", "/home/z/my-project/extracted/public"];
  const backups: any[] = [];
  for (const dir of dirs) { try { for (const f of await fs.readdir(dir)) { if (f.endsWith(".tar.gz")) { const st = await fs.stat(path.join(dir, f)); if (st.size > 1000) backups.push({ filename: f, size: st.size }); } } } catch {} }
  return NextResponse.json({ ok: true, backups, latest: backups[0] || null });
}
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    await fs.chmod(SCRIPT, 0o755).catch(() => {});
    const child = execFile("bash", [SCRIPT, "--force"], { cwd: "/home/z/my-project/extracted", timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    await new Promise<void>((r) => { child.on("close", () => r()); child.on("error", () => r()); });
    return NextResponse.json({ ok: true, stdout: stdout.slice(-500) });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 500 }); }
}