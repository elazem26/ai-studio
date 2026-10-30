import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logEvent } from "@/lib/logger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKUP_INFO_PATH = path.resolve(process.cwd(), "data/backup-info.json");
const MANAGER_KEY = "1970";
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.backupId) return NextResponse.json({ ok: false, error: "Missing backupId" }, { status: 400 });
  if (body.managerKey !== MANAGER_KEY) return NextResponse.json({ ok: false, error: "Invalid manager key" }, { status: 403 });
  try {
    const data = await fs.readFile(BACKUP_INFO_PATH, "utf-8").catch(() => "[]");
    const list = JSON.parse(data || "[]");
    const backup = list.find((b: any) => b.backupId === body.backupId);
    if (!backup) return NextResponse.json({ ok: false, error: "Backup not found" }, { status: 404 });
    const restoreSource = body.restoreSource ?? false;
    const backupRoot = backup.location;
    let restoredFiles = 0;
    for (const folder of ["data/uploads", "data/results", "db"]) {
      const src = path.join(backupRoot, folder);
      const dst = path.resolve(process.cwd(), folder);
      try { await fs.rm(dst, { recursive: true, force: true }); await copyDir(src, dst); restoredFiles++; } catch {}
    }
    await logEvent({ category: "system", message: `Backup restored: ${body.backupId}` });
    return NextResponse.json({ ok: true, backupId: body.backupId, restoredDataFolders: restoredFiles, sourceRestored: restoreSource, note: restoreSource ? "Both restored" : "Data only restored" });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
async function copyDir(src: string, dst: string) { await fs.mkdir(dst, { recursive: true }); const entries = await fs.readdir(src, { withFileTypes: true }); for (const e of entries) { const s = path.join(src, e.name); const d = path.join(dst, e.name); if (e.isDirectory()) await copyDir(s, d); else await fs.copyFile(s, d); } }
