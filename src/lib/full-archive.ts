/**
 * FULL ARCHIVE — "نسخة كمبيوتر كاملة"
 *
 * Builds a single self-contained archive of the ENTIRE project
 * (code + .env plaintext keys + db + data + models + skills)
 * split into <100MB parts served statically from /public.
 *
 * Build runs in the background (fire-and-forget) the first time
 * the studio dialog asks for the manifest. Status lives in
 * download/.full-archive-manifest.json + module state.
 */
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";

const PROJECT = "/home/z/my-project";
const PUBLIC_DIR = path.join(PROJECT, "public");
const DOWNLOAD_DIR = path.join(PROJECT, "download");
const MANIFEST = path.join(DOWNLOAD_DIR, ".full-archive-manifest.json");
const BUFFALO_ZIP = "/home/z/.insightface/models/buffalo_l.zip";

export interface ArchiveManifest {
  ready: boolean;
  building: boolean;
  builtAt?: string;
  fullSizeMB?: number;
  partCount?: number;
  parts?: { name: string; sizeMB: number }[];
  error?: string;
}

let building = false;
let lastError = "";

function run(cmd: string, args: string[], timeout = 900_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      resolve({
        code: err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0,
        stderr: err ? String((err as any).message || err).slice(-500) : "",
      });
    });
    child.on("error", () => resolve({ code: 1, stderr: "spawn failed" }));
  });
}

async function readManifest(): Promise<ArchiveManifest | null> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

async function writeManifest(m: ArchiveManifest) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  await fs.writeFile(MANIFEST, JSON.stringify(m, null, 2));
}

export async function getStatus(): Promise<ArchiveManifest> {
  const m = await readManifest();
  if (building) return { ...(m || {}), ready: false, building: true, error: lastError || undefined };
  if (m?.ready) return { ...m, building: false };
  return { ready: false, building: false, error: lastError || undefined };
}

/** Remove old parts/build artifacts from public/ */
async function cleanOldParts() {
  const entries = await fs.readdir(PUBLIC_DIR).catch(() => [] as string[]);
  for (const f of entries) {
    if (/^ai-studio-complete\.tar\.gz(\.\d+\.part)?$/.test(f) || /^combine-parts\.(sh|bat)$/.test(f)) {
      await fs.unlink(path.join(PUBLIC_DIR, f)).catch(() => {});
    }
  }
}

async function buildArchive(): Promise<void> {
  const startedAt = new Date().toISOString();
  building = true;
  lastError = "";
  try {
    // Pre-flight: the build needs ~2.2GB free (raw tar + gz coexist during
    // compression, then gz + split parts during splitting). Abort politely
    // instead of filling the disk.
    try {
      const st = await fs.statfs("/");
      const freeBytes = Number(st.bavail) * Number(st.bsize);
      if (freeBytes > 0 && freeBytes < 2_200_000_000) {
        throw new Error(`مساحة القرص غير كافية (${Math.round(freeBytes / 1048576)}MB حرة — نحتاج 2.2GB مؤقتاً)`);
      }
    } catch (e: any) {
      if (String(e?.message || "").includes("مساحة")) throw e;
      // statfs unavailable on this platform → proceed without guard
    }
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await cleanOldParts();

    // 1) uncompressed tar of the whole project (rebuildables excluded)
    const tarRaw = "/home/z/my-project/download/.full-archive-raw.tar";
    await fs.unlink(tarRaw).catch(() => {});
    let r = await run("tar", [
      "-cf", tarRaw, "-C", PROJECT, ".",
      "--exclude=./node_modules", "--exclude=./.next", "--exclude=./.git",
      "--exclude=./.gh-staging", "--exclude=./.gh-token",
      "--exclude=./download", "--exclude=backups", "--exclude=.backups",
      "--exclude=__pycache__", "--exclude=*.pyc", "--exclude=*.log",
      "--exclude=./public/ai-studio-complete.tar.gz*",
      "--exclude=./public/combine-parts.*",
      "--exclude=tsconfig.tsbuildinfo", "--exclude=.DS_Store",
    ]);
    if (r.code !== 0) throw new Error("tar(1) failed: " + r.stderr);

    // 2) append buffalo_l.zip as models/pretrained/buffalo_l.zip
    try {
      await fs.access(BUFFALO_ZIP);
      r = await run("tar", [
        "-rf", tarRaw, "-C", path.dirname(BUFFALO_ZIP),
        "--transform", `s,^${path.basename(BUFFALO_ZIP)},mini-services/face-swap-pro/models/pretrained/${path.basename(BUFFALO_ZIP)},`,
        path.basename(BUFFALO_ZIP),
      ]);
      if (r.code !== 0) throw new Error("tar(append buffalo) failed: " + r.stderr);
    } catch { /* buffalo zip missing — archive continues without it */ }

    // 3) gzip
    const tarGz = tarRaw + ".gz";
    await fs.unlink(tarGz).catch(() => {});
    r = await run("gzip", ["-f", tarRaw], 1_800_000);
    if (r.code !== 0) throw new Error("gzip failed: " + r.stderr);
    const fullSize = (await fs.stat(tarGz)).size;

    // 4) split into <100MB parts inside public/
    r = await run("split", [
      "-b", "95000000", "-d", "-a", "2",
      tarGz, path.join(PUBLIC_DIR, "ai-studio-complete.tar.gz."),
    ]);
    // split with suffix directly → ai-studio-complete.tar.gz.00 (no .part)
    // rename to *.NN.part to keep the UI contract
    const entries = await fs.readdir(PUBLIC_DIR);
    const partNames: { name: string; sizeMB: number }[] = [];
    for (const f of entries) {
      const m = f.match(/^ai-studio-complete\.tar\.gz\.(\d{2})$/);
      if (!m) continue;
      const newName = `ai-studio-complete.tar.gz.${m[1]}.part`;
      await fs.rename(path.join(PUBLIC_DIR, f), path.join(PUBLIC_DIR, newName));
      partNames.push({ name: newName, sizeMB: Math.round((await fs.stat(path.join(PUBLIC_DIR, newName))).size / 1048576) });
    }
    await fs.unlink(tarGz).catch(() => {});
    if (partNames.length === 0) throw new Error("لم تُنتج عملية التقسيم أي أجزاء");

    // 5) combine scripts
    const sh = [
      "#!/bin/bash",
      "# merge the parts back into the full archive, then extract",
      "set -e",
      'echo "merging parts..."',
      "cat ai-studio-complete.tar.gz.*.part > ai-studio-complete.tar.gz",
      'echo "verifying..."',
      "gzip -t ai-studio-complete.tar.gz && echo OK",
      'echo "extract with:  tar -xzf ai-studio-complete.tar.gz"',
      'echo "then:  bun install   (inside the folder)"',
      "AI='INSTRUCTIONS: bun install && npm run dev (or bun run dev)'",
      'echo "$AI"',
    ].join("\n");
    const bat = [
      "@echo off",
      "copy /b ai-studio-complete.tar.gz.*.part ai-studio-complete.tar.gz",
      "echo Done: ai-studio-complete.tar.gz",
      "echo Extract it with 7-Zip or WinRAR, then run: bun install && npm run dev",
      "pause",
    ].join("\r\n");
    await fs.writeFile(path.join(PUBLIC_DIR, "combine-parts.sh"), sh + "\n");
    await fs.writeFile(path.join(PUBLIC_DIR, "combine-parts.bat"), bat + "\r\n");

    await writeManifest({
      ready: true,
      building: false,
      builtAt: startedAt,
      fullSizeMB: Math.round(fullSize / 1048576),
      partCount: partNames.length,
      parts: partNames,
    });
  } catch (e: any) {
    lastError = String(e?.message || e);
    await writeManifest({ ready: false, building: false, error: lastError }).catch(() => {});
    await cleanOldParts().catch(() => {});
  } finally {
    building = false;
  }
}

/** Kick off a build if none is running. Returns status right away. */
export async function ensureBuilding(): Promise<ArchiveManifest> {
  if (building) return getStatus();
  const m = await readManifest();
  if (m?.ready) return { ...m, building: false };
  buildArchive().catch(() => {}); // fire-and-forget
  return { ready: false, building: true };
}
