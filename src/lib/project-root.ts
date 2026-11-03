import { statSync } from "fs";
import path from "path";
import { homedir } from "os";

/**
 * Project root resolution — works locally (/home/z/my-project) AND inside
 * GitHub Codespaces (/workspaces/ai-studio) where the hardcoded path
 * does not exist. Used by the full-archive builder and part downloads.
 */
export function getProjectRoot(): string {
  const candidates = [
    process.env.PROJECT_ROOT,
    "/home/z/my-project",
    "/workspaces/ai-studio",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (statSync(path.join(c, "package.json")).isFile()) return c;
    } catch {
      /* try next */
    }
  }
  // standalone server cwd = .next/standalone → root is two levels up
  return path.resolve(process.cwd(), "..", "..");
}

export const PROJECT_ROOT = getProjectRoot();

/** buffalo_l.zip lives next to the insightface home of whichever user runs us. */
export function getBuffaloZipPath(): string {
  return path.join(homedir(), ".insightface", "models", "buffalo_l.zip");
}
