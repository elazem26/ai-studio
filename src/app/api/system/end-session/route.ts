import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { openSync, promises as fs } from "fs";
import { requireAdmin } from "@/lib/auth";
import {
  buildCleanTarball, distributeToLocations,
  cleanSessionMedia, cleanJunk, gitHygiene, buildPCPackage,
  dedupeSessionMedia, dedupeScripts,
  readGitHubConfig, PROJECT,
} from "@/lib/backup";

/** Open (append) a log file for the detached GitHub push process. */
function fsOpenLog(log: string): number {
  try {
    return openSync(log, "a");
  } catch {
    return "ignore" as unknown as number;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/system/end-session   (?dryRun=1 to preview without deleting)
 *
 * The end-of-session protocol per owner spec (2026-10-29, REVISED —
 * anti-duplication):
 *   0. JUNK-CLEAN  — duplicate/unused dirs + junk files + ALL dated
 *                    backups (dated = duplicate) + duplicate download
 *                    tarball. BEFORE any backup.
 *   1. CLEAN       — delete ALL session media (uploads + results incl.
 *                    videos + temp) → no image/video in any copy.
 *   2. GIT-HYGIENE — return to the clean version: commit session work
 *                    (anti-bloat pre-commit hook active forever) + gc
 *                    prune + .git size guard.
 *   3. BACKUP      — EXACTLY 2 clean copies: 1 OUTSIDE
 *                    (/home/z/backups/ai-studio) + 1 INSIDE (data/backups),
 *                    latest-only, no dated copies.
 *   4. PC-PACKAGE  — computer version in download/ (the ONLY file there).
 *   5. GITHUB      — CLEAN source push via the locked staging chain in
 *                    the background (no media/models/junk/tarballs).
 *
 * Response: { ok, steps: [{step, ok, details}] }
 *
 * MODES (stability fix 2026-10-31):
 *   ?mode=light  → beacon/pagehide path. ONLY step 1 (privacy media
 *                  cleanup). No git ops, no tarballs, no PC package
 *                  (~800MB), no GitHub push. The heavy protocol was
 *                  firing on EVERY page reload/close and filled the
 *                  disk — the main cause of the "unexpected error
 *                  <!DOCTYPE" instability.
 *   (default)    → full protocol. Used ONLY by the explicit
 *                  "إنهاء الجلسة" button and the heartbeat
 *                  disconnect detector.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const mode = new URL(req.url).searchParams.get("mode") === "light" ? "light" : "full";

  const startedAt = Date.now();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const steps: { step: string; ok: boolean; details: Record<string, unknown> }[] = [];

  // ---- LIGHT MODE (page unload beacon): privacy media cleanup only ----
  if (mode === "light") {
    // 0) إزالة التكرارات أولًا (وسائط الجلسة + السكربتات المكررة) — متطلب المالك:
    //    عند إغلاق المتصفح تُحذف الوسائط وتُزال التكرارات في الملفات والسكربت
    try {
      const dupMedia = await dedupeSessionMedia(dryRun);
      const dupScripts = await dedupeScripts(dryRun);
      steps.push({
        step: "dedupe", ok: true,
        details: { ...dupMedia, scriptsScanned: dupScripts.scanned, scriptsRemoved: dupScripts.removed, scriptsFreedKB: dupScripts.freedKB, dryRun },
      });
    } catch (e: any) {
      steps.push({ step: "dedupe", ok: false, details: { error: e?.message } });
    }
    try {
      const clean = await cleanSessionMedia(dryRun);
      steps.push({
        step: "clean", ok: true,
        details: { ...clean, dryRun, note: "وضع خفيف (إغلاق صفحة): حُذفت صور الجلسة والفيديوهات فقط — بدون git/نسخ/GitHub" },
      });
    } catch (e: any) {
      steps.push({ step: "clean", ok: false, details: { error: e?.message } });
    }
    return NextResponse.json({ ok: true, mode, steps });
  }

  // ---- STEP 0: JUNK-CLEAN (duplicates + unused dirs + ALL dated backups) ---
  try {
    const junk = await cleanJunk(dryRun);
    const dupMedia = await dedupeSessionMedia(dryRun);
    const dupScripts = await dedupeScripts(dryRun);
    steps.push({
      step: "junk-clean", ok: true,
      details: { ...junk, mediaDedup: dupMedia, scriptsDedup: { scanned: dupScripts.scanned, removed: dupScripts.removed }, dryRun, note: dryRun ? "معاينة فقط" : "حُذفت المجلدات والملفات المكررة وكل النسخ المؤرخة + تكرارات الوسائط والسكربت" },
    });
  } catch (e: any) {
    steps.push({ step: "junk-clean", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 1: CLEAN session media -------------------------------------
  try {
    const clean = await cleanSessionMedia(dryRun);
    steps.push({
      step: "clean", ok: true,
      details: { ...clean, dryRun, note: dryRun ? "معاينة فقط — لم يُحذف شيء" : "حُذفت كل الصور والفيديوهات والنتائج" },
    });
  } catch (e: any) {
    steps.push({ step: "clean", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 2: GIT-HYGIENE — return to the clean version ----------------
  if (!dryRun) {
    try {
      const g = await gitHygiene();
      steps.push({
        step: "git-hygiene", ok: true,
        details: {
          committed: g.committed, gitSizeMB: g.gitSizeMB, warnings: g.warnings,
          note: "أُعيد المشروع للنسخة النظيفة: توثيق كل التعديلات + منع دائم للملفات الكبيرة/المكررة + ضغط التاريخ",
        },
      });
    } catch (e: any) {
      steps.push({ step: "git-hygiene", ok: false, details: { error: e?.message } });
    }
  }

  // ---- STEP 3: EXACTLY 2 clean backups (1 outside + 1 inside) -----------
  let tarFile = "";
  try {
    const tar = await buildCleanTarball(true);
    tarFile = tar.file;
    const saved = await distributeToLocations(tar.file);
    steps.push({
      step: "backup", ok: saved.length >= 2,
      details: {
        savedCount: saved.length,
        outside: saved.filter((s) => !s.location.startsWith(PROJECT)).map((s) => s.location),
        inside: saved.filter((s) => s.location.startsWith(PROJECT)).map((s) => s.location),
        sizeKB: Math.round(tar.sizeBytes / 1024),
        note: "نسختان نظيفتان فقط (1 خارج + 1 داخل) — أحدث فقط بدون نسخ مؤرخة مكررة",
      },
    });
  } catch (e: any) {
    steps.push({ step: "backup", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 4: PC-COMPLETE package (the ONLY file download/ keeps) ------
  try {
    const pc = await buildPCPackage();
    steps.push({
      step: "pc-package", ok: true,
      details: {
        file: pc.file, sizeMB: Math.round(pc.sizeBytes / 1048576), hasModels: pc.hasModels,
        note: "نسخة كمبيوتر كاملة نظيفة (بدون صور/فيديو/مكررات) — الاسم بالإصدار وتُستبدل تلقائياً بالأحدث",
      },
    });
  } catch (e: any) {
    steps.push({ step: "pc-package", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 5: GitHub — CLEAN source push (staging chain, background) ---
  {
    const { token, repo } = await readGitHubConfig();
    const repoName = repo || "ai-studio-full-backup";
    if (dryRun) {
      steps.push({
        step: "github",
        ok: !!token,
        details: token
          ? { configured: true, repo: repoName, note: "سيُدفع نسخة نظيفة معقّمة: أكواد + قاعدة بيانات بدون مفاتيح/صور/فيديو/نماذج (المستودع عام لتشغيل بضغطة واحدة)" }
          : { configured: false, error: "لا يوجد GITHUB_TOKEN صالح — أدخله من /llm-keys أو .env" },
      });
    } else if (token) {
      try {
        const log = PROJECT + "/.gh-push.log";
        const fd = fsOpenLog(log);
        const child = spawn("bash", [
          "-lc",
          `cd ${PROJECT} && bash scripts/gh-run-chain.sh '${token.replace(/'/g, "")}' '${repoName.replace(/'/g, "")}'`,
        ], {
          detached: true,
          stdio: ["ignore", fd, fd],
        });
        child.unref();
        steps.push({
          step: "github", ok: true,
          details: {
            started: true, repo: repoName,
            note: "بدأ دفع النسخة النظيفة المعقّمة (أكواد + db بدون مفاتيح/صور/فيديو/نماذج) في الخلفية — تابع في .gh-push.log",
          },
        });
      } catch (e: any) {
        steps.push({ step: "github", ok: false, details: { error: e?.message } });
      }
    } else {
      steps.push({
        step: "github", ok: false,
        details: { configured: false, error: "لا يوجد GITHUB_TOKEN — أضفه في .env ثم أعد المحاولة" },
      });
    }
  }

  // Cleanup the temp tarball
  if (tarFile) {
    fs.unlink(tarFile).catch(() => {});
  }

  const ok = steps.filter((s) => s.ok).length >= 4; // junk+media clean + backup + pc-package must pass
  return NextResponse.json({
    ok,
    dryRun,
    elapsedMs: Date.now() - startedAt,
    steps,
  });
}
