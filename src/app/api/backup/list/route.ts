import { dataRootSync } from "@/lib/security/resolve-file-path";
const DATA_ROOT = dataRootSync();
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BACKUP_INFO_PATH = path.join(DATA_ROOT, "backup-info.json");
export async function GET() {
  try { const data = await fs.readFile(BACKUP_INFO_PATH, "utf-8").catch(() => "[]"); const backups = JSON.parse(data || "[]"); return NextResponse.json({ backups, count: backups.length }); }
  catch (e) { return NextResponse.json({ backups: [], count: 0, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
