import { promises as fs } from "fs";
import path from "path";
export async function resolveFilePath(input: string): Promise<string> {
  if (!input) throw new Error("empty");
  if (input.startsWith("data:") || input.startsWith("http")) return input;
  try { await fs.access(input); return input; } catch {}
  if (input.includes("/home/z/my-project/data/")) {
    const p = input.replace("/home/z/my-project/data/", "/home/z/my-project/.next/standalone/data/");
    try { await fs.access(p); return p; } catch {}
  }
  const rel = input.startsWith("/") ? input.slice(1) : input;
  for (const c of [
    path.join("/home/z/my-project/.next/standalone/data", rel),
    path.join("/home/z/my-project/data", rel),
    path.join(process.cwd(), "data", rel),
  ]) {
    try { await fs.access(c); return c; } catch {}
  }
  throw new Error("File not found: " + input);
}
export async function resolveDataRoot(): Promise<string> {
  const candidates = [path.join(process.cwd(), "data"), "/home/z/my-project/data", "/home/z/my-project/.next/standalone/data"];
  for (const c of candidates) { try { await fs.mkdir(c, { recursive: true }); return c; } catch {} }
  return path.join(process.cwd(), "data");
}
export function pathToUrl(p: string): string {
  return p.startsWith("data:") ? p : "/" + p.replace("/home/z/my-project/.next/standalone/data", "").replace("/home/z/my-project/data", "").replace(/^\/+/, "");
}
