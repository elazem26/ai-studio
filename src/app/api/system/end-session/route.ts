import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { openSync } from "fs";
import { requireAdmin } from "@/lib/auth";
import {
  buildCleanTarball, distributeToLocations, makeDownloadReady,
  cleanSessionMedia, cleanJunk, buildPCPackage,
  uploadToGitHub, readGitHubConfig, PROJECT,
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
 * The end-of-session protocol per owner spec (2026-10-29):
 *   0. JUNK-CLEAN — delete duplicate/unused dirs (extracted, tool-results,
 *      stale backups) + prune old dated backups
 *   1. CLEAN   — delete ALL session media (uploads + results incl. videos + temp)
 *   2. BACKUP  — clean copy saved to 5 locations OUTSIDE the project
 *                + 1 location INSIDE (data/backups)
 *   3. PC-PACKAGE — complete runnable computer version (code + db + .env
 *                + models + start scripts) in download/
 *   4. DOWNLOAD-READY — small clean source copy in download/
 *   5. GITHUB  — CLEAN copy upload (code + db + .env; NO media/models/junk;
 *                needs GITHUB_TOKEN + GITHUB_BACKUP_REPO; skipped with
 *                clear message otherwise)
 *
 * Response: { ok, steps: [{step, ok, details}] }
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const startedAt = Date.now();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const steps: { step: string; ok: boolean; details: Record<string, unknown> }[] = [];

  // ---- STEP 0: JUNK-CLEAN (duplicates + unused dirs + stale backups) ---
  try {
    const junk = await cleanJunk(dryRun);
    steps.push({
      step: "junk-clean", ok: true,
      details: { ...junk, dryRun, note: dryRun ? "معاينة فقط" : "حُذفت المجلدات المكررة/غير اللازمة والنسخ القديمة" },
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

  // ---- STEP 2: 5-outside + 1-inside clean backup ------------------------
  let tarFile = "";
  try {
    const tar = await buildCleanTarball(true);
    tarFile = tar.file;
    const saved = await distributeToLocations(tar.file);
    steps.push({
      step: "backup", ok: saved.length >= 6,
      details: {
        savedCount: saved.length,
        outside: saved.filter((s) => !s.location.startsWith(PROJECT)).map((s) => s.location),
        inside: saved.filter((s) => s.location.startsWith(PROJECT)).map((s) => s.location),
        sizeKB: Math.round(tar.sizeBytes / 1024),
      },
    });
  } catch (e: any) {
    steps.push({ step: "backup", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 3: PC-COMPLETE package (code + db + .env + models) ---------
  try {
    const pc = await buildPCPackage();
    steps.push({
      step: "pc-package", ok: true,
      details: {
        file: pc.file, sizeMB: Math.round(pc.sizeBytes / 1048576), hasModels: pc.hasModels,
        note: "نسخة كمبيوتر كاملة جاهزة للتحميل والتشغيل (أكواد + قاعدة بيانات + مفاتيح + نماذج + سكربتات تشغيل)",
      },
    });
  } catch (e: any) {
    steps.push({ step: "pc-package", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 4: download-ready copy -------------------------------------
  try {
    const dl = await makeDownloadReady(tarFile);
    steps.push({
      step: "download-ready", ok: true,
      details: { file: dl.file, sizeKB: Math.round(dl.sizeBytes / 1024) },
    });
  } catch (e: any) {
    steps.push({ step: "download-ready", ok: false, details: { error: e?.message } });
  }

  // ---- STEP 5: GitHub upload — CLEAN copy (code + db + .env) -----------
  // Owner spec (2026-10-29): GitHub gets the CLEAN version — no images,
  // no videos, no models, no junk/duplicate dirs. Implemented by
  // scripts/gh-prepare-staging.sh (v3 clean staging) + gh-push-full.sh.
  {
    const { token, repo } = await readGitHubConfig();
    const repoName = repo || "ai-studio-full-backup";
    if (dryRun) {
      steps.push({
        step: "github",
        ok: !!token,
        details: token
          ? { configured: true, repo: repoName, note: "سيُرفع نسخة نظيفة: أكواد + قاعدة بيانات + مفاتيح — بدون صور ولا فيديو ولا نماذج ولا ملفات مكررة" }
          : { configured: false, error: "لا يوجد GITHUB_TOKEN صالح — أدخله من /llm-keys أو .env" },
      });
    } else if (token) {
      try {
        // Full copy in background via the LOCKED wrapper (one chain at a
        // time, fresh log per run, incremental commit → fast updates).
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
            note: "بدأ رفع النسخة النظيفة (أكواد + db + مفاتيح، بدون صور/فيديو/نماذج/مكررات) في الخلفية — تابع في .gh-push.log",
          },
        });
      } catch (e: any) {
        // Fallback: quick tarball copy via Contents API (code+keys+db, no models)
        try {
          const gh = await uploadToGitHub(tarFile);
          steps.push({
            step: "github", ok: gh.ok,
            details: gh.ok ? { url: gh.url, mode: "tarball" } : { error: gh.error },
          });
        } catch (e2: any) {
          steps.push({ step: "github", ok: false, details: { error: e2?.message || e?.message } });
        }
      }
    } else {
      try {
        const gh = await uploadToGitHub(tarFile);
        steps.push({
          step: "github", ok: gh.ok,
          details: gh.ok ? { url: gh.url, mode: "tarball" } : { error: gh.error },
        });
      } catch (e: any) {
        steps.push({ step: "github", ok: false, details: { error: e?.message } });
      }
    }
  }

  // Cleanup the temp tarball
  if (tarFile) {
    import("fs").then((m) => m.promises.unlink(tarFile).catch(() => {}));
  }

  const ok = steps.filter((s) => s.ok).length >= 4; // junk+media clean + backup + pc-package must pass
  return NextResponse.json({
    ok,
    dryRun,
    elapsedMs: Date.now() - startedAt,
    steps,
  });
}