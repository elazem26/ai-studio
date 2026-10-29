/**
 * Server-side Logger - lightweight, privacy-safe
 *
 * Writes to:
 *   - SQLite via Prisma (long-term storage)
 *   - Console (for dev mode visibility)
 *
 * NEVER logs image bytes, paths to user-uploaded content
 * (only generic category, file size, dimensions).
 */

import { db } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error" | "debug";
export type LogCategory =
  | "tryon"
  | "upload"
  | "security"
  | "system"
  | "model"
  | "export"
  | "agents";

interface LogOpts {
  level?: LogLevel;
  category: LogCategory;
  message: string;
  details?: string;
  durationMs?: number;
  modelUsed?: string;
  gpuInfo?: string;
  vramMB?: number;
}

export async function logEvent(optsOrLevel: LogOpts | LogLevel | string, maybeCategory?: LogCategory | string, maybeMessage?: string, maybeDetails?: string): Promise<void> {
  let opts: LogOpts;
  if (typeof optsOrLevel === "object" && optsOrLevel !== null && !Array.isArray(optsOrLevel)) {
    opts = optsOrLevel as LogOpts;
  } else {
    opts = {
      level: (optsOrLevel as string)?.toString?.()?.toLowerCase() as LogLevel,
      category: (maybeCategory as LogCategory) ?? ("system" as LogCategory),
      message: maybeMessage ?? "",
      details: maybeDetails,
    } as LogOpts;
  }
  const level = opts.level ?? "info";
  // Console mirror
  const ts = new Date().toISOString();
  const consoleMsg = `[${ts}] [${level.toUpperCase()}] [${opts.category}] ${opts.message}`;
  if (level === "error") {
    console.error(consoleMsg, opts.details ?? "");
  } else if (level === "warn") {
    console.warn(consoleMsg, opts.details ?? "");
  } else {
    console.log(consoleMsg, opts.details ?? "");
  }

  // Persist to SQLite
  try {
    await db.logEntry.create({
      data: {
        level,
        category: opts.category,
        message: opts.message,
        details: opts.details ?? null,
        durationMs: opts.durationMs ?? null,
        modelUsed: opts.modelUsed ?? null,
        gpuInfo: opts.gpuInfo ?? null,
        vramMB: opts.vramMB ?? null,
      },
    });
  } catch (e) {
    // DB might not be ready; never crash on log
    console.error("Failed to persist log:", e);
  }
}

/**
 * Get recent log entries (for developer panel).
 */
export async function getRecentLogs(limit = 100): Promise<
  Array<{
    id: number;
    level: string;
    category: string;
    message: string;
    details: string | null;
    durationMs: number | null;
    modelUsed: string | null;
    gpuInfo: string | null;
    vramMB: number | null;
    createdAt: Date;
  }>
> {
  return db.logEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Clear logs.
 */
export async function clearLogs(): Promise<void> {
  await db.logEntry.deleteMany({});
}
