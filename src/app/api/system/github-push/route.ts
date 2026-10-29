import { NextRequest, NextResponse } from "next/server";
import { spawn, execFile } from "child_process";
import { openSync } from "fs";
import { requireAdmin } from "@/lib/auth";
import { readGitHubConfig, PROJECT } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Append-mode handle for the detached chain's output (BUSY lines etc.). */
function fsOpenLog(log: string): number {
  try {
    return openSync(log, "a");
  } catch {
    return "ignore" as unknown as number;
  }
}

/** Non-blocking probe: is another GitHub chain currently holding the lock? */
function isChainBusy(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("flock", ["-n", PROJECT + "/.gh-lock", "true"], (err) => resolve(!!err));
  });
}

/**
 * POST /api/system/github-push
 *
 * Owner policy (2026-10-28): keep the GitHub backup ALWAYS up to date.
 * Launches scripts/gh-run-chain.sh (locked, detached — survives tab close):
 *   1. truncate .gh-push.log (fresh log per run)
 *   2. gh-prepare-staging.sh — incremental rsync of the LATEST project
 *      state + one commit with only the diff
 *   3. gh-push-full.sh — push to the PRIVATE repo (first push uploads
 *      everything, later pushes upload only changes)
 *
 * Token is read at runtime (.env file → DB llm:github_key) — no restart
 * needed after the owner pastes a new token.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const { token, repo, source } = await readGitHubConfig();
  if (!token) {
    return NextResponse.json({
      ok: false,
      error:
        "لا يوجد توكن GitHub صالح. أرسل توكن جديد (classic مع صلاحية repo) من github.com/settings/tokens ثم أدخله من صفحة /llm-keys — يُلتقط فوراً بدون إعادة تشغيل.",
    }, { status: 400 });
  }

  if (await isChainBusy()) {
    return NextResponse.json({
      ok: false, busy: true,
      error: "رفع سابق لا يزال قيد التنفيذ — انتظر انتهاءه ثم تحقق بالحالة (نقرة يمين على الزر).",
    }, { status: 409 });
  }

  const repoName = repo || "ai-studio-full-backup";
  const log = PROJECT + "/.gh-push.log";
  try {
    const fd = fsOpenLog(log);
    const child = spawn("bash", [
      "-lc",
      `cd ${PROJECT} && bash scripts/gh-run-chain.sh '${token.replace(/'/g, "")}' '${repoName.replace(/'/g, "")}'`,
    ], {
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    return NextResponse.json({
      ok: true,
      started: true,
      repo: repoName,
      tokenSource: source,
      note: "بدأ رفع أحدث نسخة إلى GitHub في الخلفية (التحديثات اللاحقة ترفع التغييرات فقط) — تابع: زر الحالة أو .gh-push.log",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "فشل بدء الرفع" }, { status: 500 });
  }
}
