import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/download-v3
 * Builds a zip snapshot of the AI Clothing Studio project
 * (excludes node_modules, .next, .git, data, large binaries),
 * and streams it back to the client.
 */
export async function GET() {
  const PROJECT = process.cwd();
  const TMP_DIR = "/tmp/ai-studio-build";
  const OUT_ZIP = "/tmp/ai-studio-v3.zip";

  try {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
    await fs.rm(OUT_ZIP, { force: true });
    await fs.mkdir(TMP_DIR, { recursive: true });

    // Mirror the project tree (without heavy dirs)
    const EXCLUDES = [
      "node_modules",
      ".next",
      ".git",
      "data",
      "dev.log",
      "server.log",
      "bun.lock",
      "download",
      "skills",
      "examples",
      "mini-services",
      ".zscripts",
    ];

    // Use rsync to copy the project (fast & excludes are easy)
    const excludeArgs = EXCLUDES.map((e) => `--exclude=${e}`).join(" ");
    execSync(`rsync -a ${excludeArgs} "${PROJECT}/" "${TMP_DIR}/"`, {
      stdio: "ignore",
    });

    // Ensure scripts/safe-restore + upload route + .env are included
    const safeRestoreSrc = path.join(PROJECT, "scripts/safe-restore");
    const safeRestoreDst = path.join(TMP_DIR, "scripts/safe-restore");
    if (await fileExists(safeRestoreSrc)) {
      await fs.mkdir(safeRestoreDst, { recursive: true });
      execSync(`rsync -a "${safeRestoreSrc}/" "${safeRestoreDst}/"`, {
        stdio: "ignore",
      });
    }

    // Ensure upload route is included (the safe one)
    const uploadRouteDir = path.join(TMP_DIR, "src/app/api/images/upload");
    await fs.mkdir(uploadRouteDir, { recursive: true });

    // Make sure prisma schema + migrations exist
    execSync(`rsync -a "${PROJECT}/prisma/" "${TMP_DIR}/prisma/"`, {
      stdio: "ignore",
    });

    // Make sure package.json + next.config + tsconfig + tailwind + postcss exist
    for (const f of [
      "package.json",
      "next.config.ts",
      "tsconfig.json",
      "postcss.config.mjs",
      "components.json",
      "eslint.config.mjs",
      "Caddyfile",
      ".gitignore",
      "README.md",
    ]) {
      const src = path.join(PROJECT, f);
      if (await fileExists(src)) {
        execSync(`cp "${src}" "${TMP_DIR}/${f}"`, { stdio: "ignore" });
      }
    }

    // Build zip
    execSync(`cd /tmp && zip -qr "${OUT_ZIP}" ai-studio-build`, {
      stdio: "ignore",
    });

    const stat = await fs.stat(OUT_ZIP);
    const data = await fs.readFile(OUT_ZIP);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="ai-clothing-studio-v3.zip"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "build-failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
