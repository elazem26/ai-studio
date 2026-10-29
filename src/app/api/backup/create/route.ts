import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logEvent } from "@/lib/logger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKUP_INFO_PATH = path.resolve(process.cwd(), "data/backup-info.json");
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const trigger = body.trigger ?? "manual";
  try {
    const backupId = `backup-${Date.now()}`;
    const timestamp = Date.now();
    const locations = [path.resolve(process.cwd(), "data/backups/local")];
    let totalFiles = 0, totalSize = 0;
    for (const loc of locations) {
      await fs.mkdir(loc, { recursive: true });
      for (const folder of ["data/uploads", "data/results", "db"]) {
        const src = path.resolve(process.cwd(), folder);
        const dst = path.join(loc, folder);
        try { await copyDir(src, dst); } catch {}
      }
      const stats = await getDirStats(loc);
      totalFiles += stats.files;
      totalSize += stats.size;
    }
    const info = { backupId, timestamp, trigger, filesCount: totalFiles, totalSize, location: locations[0], includeSource: body.includeSource ?? true };
    const data = await fs.readFile(BACKUP_INFO_PATH, "utf-8").catch(() => "[]");
    const list = JSON.parse(data || "[]");
    list.push(info);
    await fs.writeFile(BACKUP_INFO_PATH, JSON.stringify(list, null, 2));
    await logEvent({ category: "system", message: `Backup created: ${backupId}` });
    return NextResponse.json({ ok: true, backupId, timestamp, successCount: locations.length, totalLocations: locations.length, filesCount: totalFiles, totalSize });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
async function copyDir(src: string, dst: string) { await fs.mkdir(dst, { recursive: true }); const entries = await fs.readdir(src, { withFileTypes: true }); for (const e of entries) { const s = path.join(src, e.name); const d = path.join(dst, e.name); if (e.isDirectory()) await copyDir(s, d); else await fs.copyFile(s, d); } }
async function getDirStats(dir: string) { let files = 0, size = 0; const walk = async (d: string) => { const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []); for (const e of entries) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else { const s = await fs.stat(p); files++; size += s.size; } } }; await walk(dir); return { files, size }; }
