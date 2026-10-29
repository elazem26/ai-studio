/**
 * Standalone end-of-session protocol runner (bun).
 *
 * Used by the heartbeat/disconnect detector: when a session gap is
 * detected (network drop, crash, power loss — cases where the browser
 * `beforeunload` beacon never fired), the heartbeat route spawns this
 * script DETACHED so the full cleanup + backup protocol still runs.
 *
 * Protocol per owner spec (2026-10-29):
 *   0. JUNK-CLEAN   — duplicate/unused dirs + stale backups pruning
 *   1. MEDIA-CLEAN  — delete ALL uploads / results / temp / sessions
 *   2. BACKUP       — clean copy to 5 locations OUTSIDE + 1 INSIDE project
 *   3. DOWNLOAD-READY — clean tarball copy in download/
 *   4. PC-PACKAGE   — complete runnable computer version in download/
 *   5. GITHUB       — clean upload (only if token configured; errors logged)
 *
 * Run:  bun scripts/end-session-protocol.ts [trigger]
 * Log:  data/temp/end-session-<ts>.log  + updates data/session-state.json
 */
import { appendFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

// Relative imports — bun resolves TS + tsconfig paths from project root.
import {
  cleanJunk,
  cleanSessionMedia,
  buildCleanTarball,
  distributeToLocations,
  makeDownloadReady,
  buildPCPackage,
  readGitHubConfig,
  uploadToGitHub,
  PROJECT,
} from "../src/lib/backup";

const trigger = process.argv[2] || "disconnect";
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const logFile = path.join(PROJECT, "data", "temp", `end-session-${stamp}.log`);

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    console.log(line);
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, line + "\n");
  } catch {
    /* ignore */
  }
}

async function main() {
  log(`=== END-SESSION PROTOCOL START (trigger: ${trigger}) ===`);
  const result: Record<string, unknown> = { trigger, startedAt: new Date().toISOString(), steps: {} };

  // STEP 0 — junk clean
  try {
    const junk = await cleanJunk(false);
    (result.steps as any)["junk-clean"] = junk;
    log(`junk-clean: removed=${junk.removed.length} pruned=${junk.pruned.length} freed=${junk.freedKB}KB`);
  } catch (e: any) {
    log(`junk-clean FAILED: ${e?.message}`);
  }

  // STEP 1 — media clean
  try {
    const clean = await cleanSessionMedia(false);
    (result.steps as any)["media-clean"] = clean;
    log(`media-clean: uploads=${clean.deletedUploads} results=${clean.deletedResults} temp=${clean.deletedTemp} freed=${clean.freedKB}KB`);
  } catch (e: any) {
    log(`media-clean FAILED: ${e?.message}`);
  }

  // STEP 2 — 5 outside + 1 inside backup
  let tarFile = "";
  try {
    const tar = await buildCleanTarball(true);
    tarFile = tar.file;
    const saved = await distributeToLocations(tar.file);
    (result.steps as any)["backup"] = { savedCount: saved.length, sizeKB: Math.round(tar.sizeBytes / 1024) };
    log(`backup: saved ${saved.length}/6 locations, ${Math.round(tar.sizeBytes / 1024)}KB`);
  } catch (e: any) {
    log(`backup FAILED: ${e?.message}`);
  }

  // STEP 3 — download-ready copy
  try {
    if (tarFile) {
      const dl = await makeDownloadReady(tarFile);
      (result.steps as any)["download-ready"] = { file: dl.file, sizeKB: Math.round(dl.sizeBytes / 1024) };
      log(`download-ready: ${dl.file} (${Math.round(dl.sizeBytes / 1024)}KB)`);
    }
  } catch (e: any) {
    log(`download-ready FAILED: ${e?.message}`);
  }

  // STEP 4 — PC package
  try {
    const pc = await buildPCPackage();
    (result.steps as any)["pc-package"] = { file: pc.file, sizeMB: Math.round(pc.sizeBytes / 1048576), hasModels: pc.hasModels };
    log(`pc-package: ${pc.file} (${Math.round(pc.sizeBytes / 1048576)}MB, models=${pc.hasModels})`);
  } catch (e: any) {
    log(`pc-package FAILED: ${e?.message}`);
  }

  // STEP 5 — GitHub clean upload (background chain if token exists)
  try {
    const { token, repo } = await readGitHubConfig();
    if (token) {
      const gh = await uploadToGitHub(tarFile || (await buildCleanTarball(true)).file);
      (result.steps as any)["github"] = gh;
      log(`github: ok=${gh.ok} url=${gh.url || ""} error=${gh.error || ""}`);
    } else {
      (result.steps as any)["github"] = { configured: false };
      log("github: skipped — no GITHUB_TOKEN configured");
    }
  } catch (e: any) {
    log(`github FAILED: ${e?.message}`);
  }

  // Remove temp tarball
  if (tarFile) {
    const { unlink } = await import("fs").then((m) => ({ unlink: m.promises.unlink }));
    await unlink(tarFile).catch(() => {});
  }

  result.finishedAt = new Date().toISOString();
  log(`=== PROTOCOL DONE ===`);

  // Update session state: record the automatic cleanup
  try {
    const statePath = path.join(PROJECT, "data", "session-state.json");
    let state: any = {};
    try {
      state = JSON.parse(await (await import("fs")).promises.readFile(statePath, "utf8"));
    } catch { /* fresh */ }
    state.lastAutoCleanAt = Date.now();
    state.lastAutoCleanTrigger = trigger;
    state.lastAutoCleanResult = result;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

main().catch((e) => log(`FATAL: ${e?.message || e}`));
