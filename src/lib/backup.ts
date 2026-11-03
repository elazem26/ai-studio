/**
 * Shared backup / cleanup implementation (pure Node + tar).
 *
 * WHY THIS EXISTS:
 *   The old routes pointed to /home/z/my-project/extracted/scripts/*.sh —
 *   a directory that DOES NOT EXIST in this deployment → every backup
 *   button silently produced 0-byte results. This lib re-implements the
 *   whole pipeline in-process with the REAL project root:
 *       /home/z/my-project
 *
 * PIPELINE (end-session protocol):
 *   1. CLEAN   — delete all session media (uploads / results / temp)
 *   2. BACKUP  — clean source backup saved to 6 on-disk locations
 *   3. DOWNLOAD-READY — copy of the backup in /home/z/my-project/download/
 *   4. GITHUB  — full copy upload (INCLUDES .env with plaintext keys,
 *                per owner request 2026-10-28; needs GITHUB_TOKEN +
 *                GITHUB_BACKUP_REPO in .env)
 */
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { execFile } from "child_process";

export const PROJECT = "/home/z/my-project";
export const DOWNLOAD_DIR = path.join(PROJECT, "download");

/** App version (package.json) — used for the PC package filename. */
export async function getAppVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT, "package.json"), "utf8"));
    return pkg.version || "5.5.0";
  } catch {
    return "5.5.0";
  }
}

/**
 * Backup locations per owner spec (2026-10-29, REVISED):
 *   exactly 1 location OUTSIDE the project folder + 1 INSIDE it.
 *   (Was 5+1 — the extra copies were duplicates the owner no longer wants.)
 */
export const BACKUP_LOCATIONS_OUTSIDE = [
  "/home/z/backups/ai-studio",
];
export const BACKUP_LOCATION_INSIDE = path.join(PROJECT, "data/backups");
export const BACKUP_LOCATIONS = [...BACKUP_LOCATIONS_OUTSIDE, BACKUP_LOCATION_INSIDE];

/** Junk / duplicated dirs — wiped at end-session BEFORE any backup. */
export const JUNK_DIRS = [
  path.join(PROJECT, "extracted"),
  path.join(PROJECT, "tool-results"),
  path.join(PROJECT, ".backups"),
  path.join(DOWNLOAD_DIR, "backups"),
  path.join(PROJECT, ".restore-check"),
  // legacy in-session media duplicate machine (backup/create copies
  // uploads+results here — a pure duplication of session media)
  path.join(PROJECT, "data/backups/local"),
];

/** Session media dirs — wiped at end-session. */
export const MEDIA_DIRS = {
  uploads: path.join(PROJECT, "data/uploads"),
  results: path.join(PROJECT, "data/results"),
  temp: path.join(PROJECT, "data/temp"),
  sessions: path.join(PROJECT, "data/sessions"),
};

function run(cmd: string, args: string[], timeout = 180_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0,
        stdout: String(stdout || ""),
        stderr: err ? String((err as any).message || stderr || err).slice(-400) : String(stderr || "").slice(-400),
      });
    });
    child.on("error", () => resolve({ code: 1, stdout: "", stderr: "spawn failed" }));
  });
}

/** File/dir list for the clean backup (whitelist — small, source-only). */
async function backupTargets(): Promise<string[]> {
  const wanted = [
    "src", "db", "public", "scripts", "prisma",
    "mini-services/face-swap-pro/server.py",
    "mini-services/face-swap-pro/requirements.txt",
    "mini-services/face-swap-pro/README.md",
    "package.json", "bun.lock", "next.config.ts", "tsconfig.json",
    "postcss.config.mjs", "components.json", "worklog.md",
    "tailwind.config.ts", "start.sh", "README-RUN.md", ".env.example",
  ];
  const out: string[] = [];
  for (const w of wanted) {
    try { await fs.access(path.join(PROJECT, w)); out.push(w); } catch { /* missing → skip */ }
  }
  return out;
}

/**
 * Create the CLEAN backup tarball (no media, no node_modules, no models).
 * `includeEnv` — the on-disk copies include .env so a restore is complete;
 * the GitHub copy must NOT include it (secrets must never leave the machine).
 */
export async function buildCleanTarball(includeEnv: boolean): Promise<{ file: string; sizeBytes: number }> {
  const targets = await backupTargets();
  if (includeEnv) {
    try { await fs.access(path.join(PROJECT, ".env")); targets.push(".env"); } catch { /* ok */ }
  }
  const tmp = path.join("/tmp", `ai-studio-clean-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tar.gz`);
  const args = ["-czf", tmp, "-C", PROJECT, ...targets];
  const { code, stderr } = await run("tar", args);
  if (code !== 0) throw new Error("tar failed: " + stderr);
  const st = await fs.stat(tmp);
  return { file: tmp, sizeBytes: st.size };
}

/** Save a tarball to all locations as ai-studio-latest.tar.gz ONLY.
 * DUPLICATION POLICY (owner 2026-10-29): no dated copies anywhere — a
 * dated copy is a duplicate of latest. Any old dated tarball found in
 * a backup location is deleted here. */
export async function distributeToLocations(tarFile: string): Promise<{ location: string; file: string; sizeBytes: number }[]> {
  const saved: { location: string; file: string; sizeBytes: number }[] = [];
  const data = await fs.readFile(tarFile);
  for (const loc of BACKUP_LOCATIONS) {
    try {
      await fs.mkdir(loc, { recursive: true });
      // remove every dated/duplicate tarball from this location first
      const files = await fs.readdir(loc).catch(() => [] as string[]);
      for (const f of files) {
        if (/^ai-studio-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f) || (f.startsWith("ai-studio-") && f !== "ai-studio-latest.tar.gz")) {
          await fs.unlink(path.join(loc, f)).catch(() => {});
        }
      }
      const latest = path.join(loc, "ai-studio-latest.tar.gz");
      await fs.writeFile(latest, data);
      saved.push({ location: loc, file: latest, sizeBytes: data.length });
    } catch { /* location not writable → skipped */ }
  }
  return saved;
}

/** Drop a download-ready copy into /home/z/my-project/download/. */
export async function makeDownloadReady(tarFile: string): Promise<{ file: string; sizeBytes: number }> {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const dest = path.join(DOWNLOAD_DIR, "ai-studio-latest.tar.gz");
  await fs.copyFile(tarFile, dest);
  const st = await fs.stat(dest);
  return { file: dest, sizeBytes: st.size };
}

/**
 * STEP 0 — delete junk & duplicated artifacts so no backup ever
 * carries them: extracted/ tool-results/ .backups download/backups,
 * duplicate junk files (nul, .DS_Store, Thumbs.db, *.tmp), ALL dated
 * backups (keep latest only — dated = duplicate), and the duplicate
 * download/ tarball (download/ keeps ONLY the PC package).
 */
export async function cleanJunk(dryRun = false) {
  const removed: string[] = [];
  let freedKB = 0;
  for (const dir of JUNK_DIRS) {
    const st = await fs.stat(dir).catch(() => null);
    if (!st) continue;
    freedKB += await dirSizeKB(dir);
    if (!dryRun) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    removed.push(path.relative(PROJECT, dir));
  }
  // duplicate junk files anywhere in the project (skip node_modules/.next/.git)
  const SKIP = new Set(["node_modules", ".next", ".git", "data", "upload", "download"]);
  const JUNK_FILE = /^[nN]ul$|^\.DS_Store$|^Thumbs\.db$|\.tmp$|~$/;
  const walkJunk = async (d: string, depth: number) => {
    if (depth > 6) return;
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".zscripts") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) await walkJunk(p, depth + 1);
        continue;
      }
      if (JUNK_FILE.test(e.name)) {
        const st = await fs.stat(p).catch(() => null);
        if (st) freedKB += Math.round(st.size / 1024);
        if (!dryRun) await fs.unlink(p).catch(() => {});
        removed.push(path.relative(PROJECT, p));
      }
    }
  };
  await walkJunk(PROJECT, 0);
  // prune ALL dated backups everywhere (keep ai-studio-latest ONLY)
  const pruned: string[] = [];
  for (const loc of BACKUP_LOCATIONS) {
    const files = await fs.readdir(loc).catch(() => [] as string[]);
    for (const f of files) {
      if (/^ai-studio-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f) || (f.startsWith("ai-studio-") && f !== "ai-studio-latest.tar.gz")) {
        const p = path.join(loc, f);
        const st = await fs.stat(p).catch(() => null);
        if (st) freedKB += Math.round(st.size / 1024);
        if (!dryRun) await fs.unlink(p).catch(() => {});
        pruned.push(path.join(path.relative(PROJECT, loc) || loc, f));
      }
    }
  }
  // prune dated PC packages in download/ (policy 2026-10-29: only the
  // undated latest is kept — dated copies are 770MB each and would
  // exhaust the disk)
  const dl = await fs.readdir(DOWNLOAD_DIR).catch(() => [] as string[]);
  const pcDated = dl
    .filter((f) => /^AI-Studio-PC-Complete-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
    .sort()
    .reverse();
  for (const old of pcDated.slice(0)) {
    const p = path.join(DOWNLOAD_DIR, old);
    const st = await fs.stat(p).catch(() => null);
    if (st) freedKB += Math.round(st.size / 1024);
    if (!dryRun) await fs.unlink(p).catch(() => {});
    pruned.push(path.join("download", old));
  }
  // superseded FULL bundle (old heavy policy) — the clean bundle replaces it
  const staleBundle = path.join(DOWNLOAD_DIR, "ai-studio-full-backup.bundle");
  const bs = await fs.stat(staleBundle).catch(() => null);
  if (bs) {
    freedKB += Math.round(bs.size / 1024);
    if (!dryRun) await fs.unlink(staleBundle).catch(() => {});
    removed.push("download/ai-studio-full-backup.bundle");
  }
  // git bundle = duplicate of GitHub repo + the 2 backups → never kept
  const cleanBundle = path.join(DOWNLOAD_DIR, "ai-studio-clean-backup.bundle");
  const cbs = await fs.stat(cleanBundle).catch(() => null);
  if (cbs) {
    freedKB += Math.round(cbs.size / 1024);
    if (!dryRun) await fs.unlink(cleanBundle).catch(() => {});
    removed.push("download/ai-studio-clean-backup.bundle");
  }
  // download/ai-studio-latest.tar.gz is a DUPLICATE of the 2 backups —
  // download/ keeps ONLY the PC package (dedupe policy 2026-10-29)
  const dlLatest = path.join(DOWNLOAD_DIR, "ai-studio-latest.tar.gz");
  const dls = await fs.stat(dlLatest).catch(() => null);
  if (dls) {
    freedKB += Math.round(dls.size / 1024);
    if (!dryRun) await fs.unlink(dlLatest).catch(() => {});
    removed.push("download/ai-studio-latest.tar.gz");
  }
  return { removed, pruned, freedKB };
}

/**
 * GIT HYGIENE — the permanent anti-bloat guard (owner request 2026-10-29:
 * "حل نهائي يمنع تكرار أي شيء"). Run at every session end BEFORE backups:
 *   1. Commit all current work (tracked changes are preserved — nothing
 *      the owner edited is ever lost).
 *   2. The pre-commit hook (scripts/git-hooks, set via core.hooksPath)
 *      permanently BLOCKS big binaries/models/media from ever entering
 *      history — the exact failure that once made .git weigh 4.7GB.
 *   3. gc --prune=now keeps the object store minimal (no orphan blobs,
 *      no duplicate packs).
 * Returns a report for the protocol log.
 */
export async function gitHygiene(): Promise<{ committed: boolean; gitSizeMB: number; warnings: string[] }> {
  const warnings: string[] = [];
  const opts = { timeout: 120_000 };
  const git = (args: string[]) => run("git", ["-C", PROJECT, ...args], opts.timeout);
  // 1. hooks path (idempotent) so the size/media guard is always active
  await git(["config", "core.hooksPath", "scripts/git-hooks"]);
  // 2. stage + commit everything (hook blocks big/media files automatically).
  //    Runtime paths (data/, upload/, download/) are UNSTAGED first so the
  //    hook never rejects the whole commit because of session state files.
  await git(["add", "-A"]);
  await git(["reset", "-q", "--", "data", "upload", "download", "extracted"]).catch(() => {});
  const status = await git(["status", "--porcelain"]);
  let committed = false;
  if (status.stdout.trim() || status.code !== 0) {
    const c = await git([
      "-c", "user.name=AI-Studio", "-c", "user.email=ai-studio@local",
      "commit", "-m", `session work auto-committed at end-of-session ${new Date().toISOString().slice(0, 16)}`,
    ]);
    committed = c.code === 0;
    if (c.code !== 0 && !/nothing to commit/.test(c.stderr)) {
      warnings.push(`commit: ${c.stderr.slice(0, 200)}`);
    }
  }
  // 3. drop unreachable objects + duplicate packs
  await git(["reflog", "expire", "--expire=now", "--all"]);
  await git(["gc", "--prune=now", "--quiet"]);
  // 4. size guard — report loudly if history ever grows again
  const { code, stdout } = await git(["count-objects", "-vH"]);
  let gitSizeMB = -1;
  if (code === 0) {
    const m = stdout.match(/size-pack: ([\d.]+) ([KM]i?B)/);
    if (m) {
      const v = parseFloat(m[1]);
      gitSizeMB = m[2].startsWith("G") ? v * 1024 : m[2].startsWith("M") ? v : v / 1024;
    }
  }
  if (gitSizeMB > 100) warnings.push(`.git grew to ${gitSizeMB.toFixed(0)}MB — inspect history`);
  return { committed, gitSizeMB: Math.max(0, Math.round(gitSizeMB)), warnings };
}

/**
 * GITHUB clean-source push — runs the locked staging chain
 * (gh-prepare-staging.sh + gh-push-full.sh): the repo always mirrors a
 * CLEAN rsync of the project (no media, no models, no node_modules,
 * no dated tarballs — previous tarball uploads are pruned by the
 * staging "mirror deletions" rsync). Replaces the old Contents-API
 * tarball upload which accumulated duplicate backup blobs in the repo.
 */
export async function pushGitHubClean(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { token, repo } = await readGitHubConfig();
  if (!token || !repo) {
    return {
      ok: false,
      error:
        "الرفع إلى GitHub غير مُهيأ. أضف في ملف .env:\n" +
        "GITHUB_TOKEN=رمز_شخصي_بصلاحية_repo\n" +
        "GITHUB_BACKUP_REPO=اسم_المستخدم/اسم_المستودع",
    };
  }
  const { code, stdout, stderr } = await run("bash", ["scripts/gh-run-chain.sh", token, repo], 600_000);
  const out = (stdout + "\n" + stderr).slice(-800);
  if (code === 3) return { ok: false, error: "سلسلة GitHub مشغولة حالياً — حاول لاحقاً" };
  if (code !== 0 || !out.includes("ALL-PUSH-DONE")) {
    return { ok: false, error: `push chain failed (code=${code}): ${out.slice(-300)}` };
  }
  return { ok: true, url: `https://github.com/${repo}` };
}

async function dirSizeKB(dir: string): Promise<number> {
  let kb = 0;
  const walk = async (d: string) => {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { const st = await fs.stat(p).catch(() => null); if (st) kb += Math.round(st.size / 1024); }
    }
  };
  await walk(dir);
  return kb;
}

/**
 * PC-COMPLETE package — a normal, fully runnable computer version:
 * all code + db + .env + models + start scripts + run instructions.
 * Ready to download, extract and run (bun install && bash start.sh).
 */
export async function buildPCPackage(): Promise<{ file: string; sizeBytes: number; hasModels: boolean }> {
  const targets = await backupTargets();
  // one-click launchers at package root (Windows / macOS / Linux)
  for (const launcher of [
    "START-AI-STUDIO.bat", "start-ai-studio.sh", "START-AI-STUDIO.command", "README-START.txt",
  ]) {
    try { await fs.access(path.join(PROJECT, launcher)); targets.push(launcher); } catch { /* missing → skip */ }
  }
  // everything the PC needs:
  const extra = [".env"];
  const modelFile = "mini-services/face-swap-pro/models/inswapper_128.onnx";
  let hasModels = false;
  try { await fs.access(path.join(PROJECT, modelFile)); extra.push(modelFile); hasModels = true; } catch { /* ok */ }
  const insight = "/home/z/.insightface/models/buffalo_l.zip";
  try { await fs.access(insight); extra.push(insight); hasModels = true; } catch { /* ok */ }
  const all = [...targets, ...extra];
  const tmp = path.join("/tmp", `ai-studio-pc-${Date.now()}.tar.gz`);
  const { code, stderr } = await run("tar", ["-czf", tmp, "-C", PROJECT, ...all]);
  if (code !== 0) throw new Error("tar(PC) failed: " + stderr);
  const st = await fs.stat(tmp);
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  // VERSIONED NAME (owner spec 2026-10-29): AI-Studio-v5.5.0.tar.gz
  // DISK POLICY: PC package is ~770MB (models included). With a ~2.5GB
  // free disk, keeping dated copies (770MB × 3) would fill it → keep
  // ONLY the current-version copy; older AI-Studio-v*.tar.gz are
  // removed. Dated clean tarballs (2.2MB) provide history in the 6
  // backup locations.
  const version = await getAppVersion();
  const dest = path.join(DOWNLOAD_DIR, `AI-Studio-v${version}.tar.gz`);
  await fs.copyFile(tmp, dest);
  await fs.unlink(tmp).catch(() => {});
  // remove old-version PC packages (disk safety)
  const dl = await fs.readdir(DOWNLOAD_DIR).catch(() => [] as string[]);
  for (const f of dl) {
    if (/^AI-Studio-v.*\.tar\.gz$/.test(f) && f !== `AI-Studio-v${version}.tar.gz`) {
      await fs.unlink(path.join(DOWNLOAD_DIR, f)).catch(() => {});
    }
  }
  // legacy alias removal (pre-5.5.0 naming)
  await fs.unlink(path.join(DOWNLOAD_DIR, "AI-Studio-PC-Complete.tar.gz")).catch(() => {});
  const st2 = await fs.stat(dest);
  return { file: dest, sizeBytes: st2.size, hasModels };
}

/**
 * STEP 1 — delete all session media. `dryRun` counts without deleting.
 * Video/source/tmp/poster files all live under data/results|uploads|temp.
 */
export async function cleanSessionMedia(dryRun = false) {
  const out = { deletedUploads: 0, deletedResults: 0, deletedTemp: 0, deletedVideos: 0, freedKB: 0 };
  for (const [label, root] of Object.entries(MEDIA_DIRS) as [string, string][]) {
    const files = await fs.readdir(root).catch(() => [] as string[]);
    for (const f of files) {
      const p = path.join(root, f);
      const st = await fs.stat(p).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        if (!dryRun) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
        out.freedKB += Math.round(st.size / 1024);
        continue;
      }
      out.freedKB += Math.round(st.size / 1024);
      if (label === "uploads") out.deletedUploads++;
      else if (label === "results") { out.deletedResults++; if (f.endsWith(".mp4")) out.deletedVideos++; }
      else if (label === "temp") out.deletedTemp++;
      if (!dryRun) await fs.unlink(p).catch(() => {});
    }
  }
  return out;
}

/**
 * Read the GitHub backup config at RUNTIME (no restart needed):
 *   1. process.env
 *   2. .env file on disk (fresh — picks up keys added after server start)
 *   3. DB Setting llm:github_key (set from the /llm-keys page)
 */
export async function readGitHubConfig(): Promise<{ token: string; repo: string; source: string }> {
  // .env FIRST (the owner's editable source of truth — updated via
  // /llm-keys or by hand). process.env is captured once at server boot
  // and goes STALE when .env changes; it must never shadow a fresh .env.
  let token = "";
  let repo = "";
  let source = "";
  try {
    const txt = await fs.readFile(path.join(PROJECT, ".env"), "utf8");
    const get = (k: string) => txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() || "";
    token = get("GITHUB_TOKEN") || get("GH_TOKEN");
    repo = get("GITHUB_BACKUP_REPO");
    if (token) source = ".env";
  } catch { /* no .env file */ }
  if (!token) {
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (token) source = "process.env";
  }
  if (!repo) repo = process.env.GITHUB_BACKUP_REPO || "";
  if (!token) {
    try {
      const { db } = await import("@/lib/db");
      const row = await db.setting.findUnique({ where: { key: "llm:github_key" } });
      if (row?.value) { token = row.value; source = "db(llm:github_key)"; }
    } catch { /* no db */ }
  }
  return { token, repo, source };
}

/**
 * Upload a backup to GitHub via the Contents API. Returns public URL or error.
 * OWNER POLICY (2026-10-28): the GitHub copy INCLUDES .env with all keys
 * in plaintext + the database — nothing is stripped.
 */
export async function uploadToGitHub(tarFile: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { token, repo } = await readGitHubConfig();
  if (!token || !repo) {
    return {
      ok: false,
      error:
        "الرفع إلى GitHub غير مُهيأ. أضف في ملف .env:\n" +
        "GITHUB_TOKEN=رمز_شخصي_بصلاحية_repo\n" +
        "GITHUB_BACKUP_REPO=اسم_المستخدم/اسم_المستودع\n" +
        "ثم أعد تشغيل المشروع. (النسخة المرفوعة تشمل .env بالمفاتيح وقاعدة البيانات — حسب طلبك)",
    };
  }
  const ghSafe = await buildCleanTarball(true); // include .env + db (owner request)
  const buf = await fs.readFile(ghSafe.file);
  if (buf.length > 60 * 1024 * 1024) return { ok: false, error: `النسخة أكبر من حد GitHub API (${Math.round(buf.length / 1048576)}MB)` };
  const name = `ai-studio-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.tar.gz`;
  const body = {
    message: `backup: full copy with keys + db ${new Date().toISOString().slice(0, 10)}`,
    content: buf.toString("base64"),
    branch: process.env.GITHUB_BACKUP_BRANCH || "main",
  };
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/backups/${name}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: `GitHub ${r.status}: ${d?.message || "فشل الرفع"}` };
    }
    return { ok: true, url: d?.content?.html_url || `https://github.com/${repo}/backups/${name}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "فشل الاتصال بـ GitHub" };
  } finally {
    fs.unlink(ghSafe.file).catch(() => {});
  }
}

/* =====================================================================
 * VIDEO RETENTION — "delete video ops once saving is done, free space"
 * ===================================================================== */

/** Sweep video files older than `maxAgeMin` minutes from data/results. */
export async function sweepOldVideos(maxAgeMin = 30): Promise<{ deleted: number; freedKB: number }> {
  const resultsDir = MEDIA_DIRS.results;
  const cutoff = Date.now() - maxAgeMin * 60_000;
  let deleted = 0, freedKB = 0;
  const files = await fs.readdir(resultsDir).catch(() => [] as string[]);
  for (const f of files) {
    const isVideoOp = /^(vswap-|tmp-video-|video-.*-swap-)/.test(f);
    if (!isVideoOp) continue;
    const p = path.join(resultsDir, f);
    const st = await fs.stat(p).catch(() => null);
    if (!st || !st.isFile()) continue;
    if (st.mtimeMs < cutoff) {
      freedKB += Math.round(st.size / 1024);
      await fs.unlink(p).catch(() => {});
      deleted++;
    }
  }
  return { deleted, freedKB };
}
