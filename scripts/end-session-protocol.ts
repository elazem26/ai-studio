/**
 * Standalone end-of-session protocol runner (bun).
 *
 * Used by the heartbeat/disconnect detector: when a session gap is
 * detected (network drop, crash, power loss — cases where the browser
 * `beforeunload` beacon never fired), the heartbeat route spawns this
 * script DETACHED so the full cleanup + backup protocol still runs.
 *
 * Protocol per owner spec (2026-10-29, REVISED — anti-duplication):
 *   0. JUNK-CLEAN    — duplicate/unused dirs + junk files + ALL dated
 *                      backups (dated = duplicate) + duplicate download
 *                      tarball. Runs BEFORE any backup.
 *   1. MEDIA-CLEAN   — delete ALL uploads / results / temp / sessions
 *                      (no image/video ever reaches a backup).
 *   2. GIT-HYGIENE   — return the project to the clean version: commit
 *                      all session work (anti-bloat hook blocks big
 *                      files forever) + gc prune + .git size guard.
 *   3. BACKUP        — EXACTLY 2 clean copies: 1 OUTSIDE the project
 *                      (/home/z/backups/ai-studio) + 1 INSIDE
 *                      (data/backups) — latest-only, no dated copies.
 *   4. PC-PACKAGE    — computer version in download/ (versioned name,
 *                      latest-only; the only file download/ keeps).
 *   5. GITHUB        — CLEAN source push via the locked staging chain
 *                      (no media, no models, no tarball accumulation).
 *
 * Run:  bun scripts/end-session-protocol.ts [trigger]
 * Log:  data/temp/end-session-<ts>.log  + updates data/session-state.json
 */
import { appendFileSync, writeFileSync, mkdirSync } from "fs";
import { promises as fs } from "fs";
import path from "path";

// Relative imports — bun resolves TS + tsconfig paths from project root.
import {
  cleanJunk,
  cleanSessionMedia,
  gitHygiene,
  buildCleanTarball,
  distributeToLocations,
  buildPCPackage,
  pushGitHubClean,
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

  // STEP 0 — junk + duplicate clean (BEFORE backups, per owner spec)
  try {
    const junk = await cleanJunk(false);
    (result.steps as any)["junk-clean"] = junk;
    log(`junk-clean: removed=${junk.removed.length} pruned=${junk.pruned.length} freed=${junk.freedKB}KB`);
  } catch (e: any) {
    log(`junk-clean FAILED: ${e?.message}`);
  }

  // STEP 1 — media clean (no images/videos in any copy)
  try {
    const clean = await cleanSessionMedia(false);
    (result.steps as any)["media-clean"] = clean;
    log(`media-clean: uploads=${clean.deletedUploads} results=${clean.deletedResults} temp=${clean.deletedTemp} freed=${clean.freedKB}KB`);
  } catch (e: any) {
    log(`media-clean FAILED: ${e?.message}`);
  }

  // STEP 2 — git hygiene: return to the clean version, block bloat forever
  try {
    const gh2 = await gitHygiene();
    (result.steps as any)["git-hygiene"] = gh2;
    log(`git-hygiene: committed=${gh2.committed} .git=${gh2.gitSizeMB}MB warnings=${JSON.stringify(gh2.warnings)}`);
  } catch (e: any) {
    log(`git-hygiene FAILED: ${e?.message}`);
  }

  // STEP 3 — backup: EXACTLY 2 locations (1 outside + 1 inside), latest-only
  let tarFile = "";
  try {
    const tar = await buildCleanTarball(true);
    tarFile = tar.file;
    const saved = await distributeToLocations(tar.file);
    (result.steps as any)["backup"] = { savedCount: saved.length, locations: saved.map((s) => s.location), sizeKB: Math.round(tar.sizeBytes / 1024) };
    log(`backup: saved ${saved.length}/2 locations [${saved.map((s) => s.location).join(", ")}], ${Math.round(tar.sizeBytes / 1024)}KB`);
  } catch (e: any) {
    log(`backup FAILED: ${e?.message}`);
  }

  // STEP 4 — PC package (versioned, latest-only; the ONLY file in download/)
  try {
    const pc = await buildPCPackage();
    (result.steps as any)["pc-package"] = { file: pc.file, sizeMB: Math.round(pc.sizeBytes / 1048576), hasModels: pc.hasModels };
    log(`pc-package: ${pc.file} (${Math.round(pc.sizeBytes / 1048576)}MB, models=${pc.hasModels})`);
  } catch (e: any) {
    log(`pc-package FAILED: ${e?.message}`);
  }

  // STEP 5 — GitHub CLEAN source push (staging chain — no tarball duplicates)
  try {
    const gh = await pushGitHubClean();
    (result.steps as any)["github"] = gh;
    log(`github: ok=${gh.ok} url=${gh.url || ""} error=${gh.error || ""}`);
  } catch (e: any) {
    log(`github FAILED: ${e?.message}`);
  }

  // Remove temp tarball
  if (tarFile) {
    await fs.unlink(tarFile).catch(() => {});
  }

  result.finishedAt = new Date().toISOString();
  log(`=== PROTOCOL DONE ===`);

  // Update session state: record the automatic cleanup
  try {
    const statePath = path.join(PROJECT, "data", "session-state.json");
    let state: any = {};
    try {
      state = JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch { /* fresh */ }
    state.lastAutoCleanAt = Date.now();
    state.lastAutoCleanTrigger = trigger;
    state.lastAutoCleanResult = result;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

main().catch((e) => log(`FATAL: ${e?.message || e}`));
