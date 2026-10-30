import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { requireAdmin } from "@/lib/auth";
import { readGitHubConfig } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "/home/z/.gh-push.log"; // outside the project dir — the dev server must not watch it
const DONE_MARKERS = ["ALL-PUSH-DONE", "PUSH FAILED", "FATAL:"];
const PREP_DONE = "ALL-PREP-DONE";

/**
 * GET /api/system/github-status
 * Reports the state of the last/running GitHub push:
 *   running / success / failed + log tail + commit info.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const { repo } = await readGitHubConfig();
  let txt = "";
  let mtime = 0;
  try {
    txt = await fs.readFile(LOG, "utf8");
    mtime = (await fs.stat(LOG)).mtimeMs;
  } catch {
    return NextResponse.json({
      ok: true, state: "idle",
      message: "لا يوجد رفع بعد — اضغط زر الرفع لبدء نسخة محدثة إلى GitHub",
      repo: repo || "ai-studio-full-backup",
    });
  }

  const lines = txt.replace(/\0/g, "").split("\n");
  const tail = lines.slice(-14).filter(Boolean).join("\n");
  const hasDone = DONE_MARKERS.some((m) => txt.includes(m));
  const prepDone = txt.includes(PREP_DONE);
  const failed = txt.includes("PUSH FAILED") || txt.includes("FATAL:");
  const pushOk = txt.includes("ALL-PUSH-DONE");
  const commit = txt.match(/commit: (\S+)/)?.[1] || "";
  const ageMin = Math.round((Date.now() - mtime) / 60000);

  let state: "running" | "success" | "failed" = "running";
  if (hasDone) state = failed ? "failed" : pushOk ? "success" : "running";
  else if (ageMin > 20) state = failed ? "failed" : "running";

  const message =
    state === "success"
      ? `آخر رفع ناجح — commit ${commit || "؟"} (قبل ${ageMin} دقيقة)`
      : state === "failed"
        ? "فشل الرفع — راجع نهاية السجل أدناه (الأشيع: توكن منتهي)"
        : `الرفع قيد التنفيذ الآن... (آخر تحديث قبل ${ageMin} دقيقة)`;

  return NextResponse.json({
    ok: true, state, prepDone, pushOk, failed, commit, ageMin,
    repo: repo || "ai-studio-full-backup",
    message, logTail: tail,
  });
}
