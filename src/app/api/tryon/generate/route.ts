import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { getAdapter, selectBestModel } from "@/lib/ai/model-manager";
import type { HardwareSnapshot } from "@/lib/ai/model-manager";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory registry of active try-on tasks.
 * Used by /api/tryon/cancel and /api/tryon/status.
 *
 * IMPORTANT: We attach these Maps to `globalThis` so they persist
 * across Next.js dev-mode module reloads. Without this, polling
 * would always see empty Maps because the module gets re-instantiated.
 */
interface ActiveTask {
  id: string;
  abort: AbortController;
  startedAt: number;
  sourcePath: string;
  garmentPath: string;
}

interface GenerationResult {
  success: boolean;
  results?: Array<{
    path: string;
    url: string;
    width: number;
    height: number;
    seedUsed: string;
    quality?: unknown;
  }>;
  errorKey?: string;
  errorMessage?: string;
  generationMs?: number;
  modelUsed?: string;
  steps: Array<{ stage: string; percent: number; labelKey: string; detail?: string; ts: number }>;
}

type GlobalState = {
  activeTasks?: Map<string, ActiveTask>;
  generationProgress?: Map<string, GenerationResult["steps"]>;
  generationResults?: Map<string, GenerationResult>;
};

const g = globalThis as unknown as GlobalState;
if (!g.activeTasks) g.activeTasks = new Map();
if (!g.generationProgress) g.generationProgress = new Map();
if (!g.generationResults) g.generationResults = new Map();

export const activeTasks: Map<string, ActiveTask> = g.activeTasks;
export const generationProgress: Map<string, GenerationResult["steps"]> = g.generationProgress;
export const generationResults: Map<string, GenerationResult> = g.generationResults;

export function getActiveTask(id: string): ActiveTask | undefined {
  return activeTasks.get(id);
}
export function cancelActiveTask(id: string): boolean {
  const t = activeTasks.get(id);
  if (!t) return false;
  t.abort.abort();
  activeTasks.delete(id);
  return true;
}

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
const TEMP_ROOT = path.resolve(process.cwd(), "data/temp");

interface GenerateBody {
  sourcePath: string;
  /** Optional when using text description only */
  garmentPath?: string;
  /** Optional text description (used when no garment image) */
  garmentDescription?: string;
  settings: {
    garmentFidelity: number;
    identityPreservation: number;
    bodyPreservation: number;
    lightingMatch: number;
    colorMatch: number;
    textureFidelity: number;
    generationSteps: number;
    guidance: number;
    seed: number | null;
    resolution: "standard" | "high" | "max";
    numResults: 1 | 2 | 4 | 8;
  };
  /** Model id override — null/empty = auto-select */
  modelId?: string;
  hardware: HardwareSnapshot;
}

/**
 * POST /api/tryon/generate
 * Body: GenerateBody JSON.
 *
 * Returns:
 *   { taskId: string } - 200
 *   { error, message } - 400/500
 *
 * The frontend then subscribes to GET /api/tryon/status?id=<taskId> (SSE)
 * for progress events.
 */
export async function POST(req: NextRequest) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json(
      { error: "errors.unknown", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.sourcePath) {
    return NextResponse.json(
      { error: "errors.noSourceImage" },
      { status: 400 }
    );
  }
  // Either a garment image OR a garment description is required
  if (!body.garmentPath && !body.garmentDescription?.trim()) {
    return NextResponse.json(
      { error: "errors.noGarmentImage" },
      { status: 400 }
    );
  }

  // Verify source file exists on disk (defense against tampering)
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json(
      { error: "errors.invalidImage", message: "Source file missing on disk" },
      { status: 400 }
    );
  }
  // If garment image provided, resolve URL path → filesystem path
  if (body.garmentPath) {
    try {
      body.garmentPath = await resolveFilePath(body.garmentPath);
    } catch {
      body.garmentPath = undefined;
    }
  }

  // Pick the model
  const modelId = body.modelId ?? (await selectBestModel(body.hardware));
  const adapter = getAdapter(modelId);
  if (!adapter) {
    return NextResponse.json(
      { error: "errors.modelNotInstalled", message: `Unknown model ${modelId}` },
      { status: 400 }
    );
  }

  const installed = await adapter.isInstalled();
  if (!installed) {
    return NextResponse.json(
      {
        error: "errors.modelNotInstalled",
        message: `Model ${modelId} is not installed on this machine. Open Model Manager to install it.`,
      },
      { status: 503 }
    );
  }

  const taskId = randomUUID();
  const abort = new AbortController();
  activeTasks.set(taskId, {
    id: taskId,
    abort,
    startedAt: Date.now(),
    sourcePath: body.sourcePath,
    garmentPath: body.garmentPath,
  });

  // Run the generation in the background; the SSE endpoint will poll progress
  void runGeneration(taskId, body, adapter).catch(async (e) => {
    await logEvent({
      category: "tryon",
      level: "error",
      message: `Generation task ${taskId} crashed`,
      details: e instanceof Error ? e.message : String(e),
      modelUsed: modelId,
    });
    // Mark task as failed
    generationResults.set(taskId, {
      success: false,
      errorKey: "errors.generationFailed",
      errorMessage: e instanceof Error ? e.message : String(e),
      generationMs: Date.now() - (activeTasks.get(taskId)?.startedAt ?? Date.now()),
      modelUsed: modelId,
    });
    activeTasks.delete(taskId);
  });

  return NextResponse.json({ taskId, modelId });
}

async function runGeneration(taskId: string, body: GenerateBody, adapter: NonNullable<ReturnType<typeof getAdapter>>) {
  const startedAt = Date.now();
  const steps: GenerationResult["steps"] = [];
  generationProgress.set(taskId, steps);

  // Pre-step: validating input (already done at API entry, but record it)
  steps.push({
    stage: "validating",
    percent: 2,
    labelKey: "progress.validating",
    ts: Date.now(),
  });
  generationProgress.set(taskId, [...steps]);

  const response = await adapter.generate({
    sourcePath: body.sourcePath,
    garmentPath: body.garmentPath ?? "",
    garmentDescription: body.garmentDescription,
    settings: body.settings,
    hardware: body.hardware,
    signal: activeTasks.get(taskId)?.abort.signal,
    onProgress: (step) => {
      steps.push({
        stage: step.stage,
        percent: step.percent,
        labelKey: step.labelKey,
        detail: step.detail,
        ts: Date.now(),
      });
      generationProgress.set(taskId, [...steps]);
    },
  });

  const generationMs = Date.now() - startedAt;

  if (!response.success || !response.results) {
    generationResults.set(taskId, {
      success: false,
      errorKey: response.errorKey,
      errorMessage: response.errorMessage,
      generationMs,
      modelUsed: response.modelUsed,
      steps,
    });
    activeTasks.delete(taskId);
    await logEvent({
      category: "tryon",
      level: "error",
      message: `Task ${taskId} failed`,
      details: response.errorMessage,
      durationMs: generationMs,
      modelUsed: response.modelUsed,
    });
    return;
  }

  // Convert absolute paths to safe URLs served by /api/results/[name]
  const resultsWithURLs = await Promise.all(
    response.results.map(async (r) => {
      // Generate a thumbnail too
      const ext = path.extname(r.path) || ".png";
      const baseName = path.basename(r.path, ext);
      const thumbName = `${baseName}-thumb${ext}`;
      const thumbPath = path.join(RESULTS_ROOT, thumbName);
      try {
        await fs.mkdir(RESULTS_ROOT, { recursive: true });
        await sharp(r.path)
          .resize(256, 256, { fit: "cover" })
          .toFile(thumbPath);
      } catch (e) {
        console.warn("Thumbnail generation failed:", e);
      }
      const url = `/results/${path.basename(r.path)}`;
      const thumbUrl = `/results/${thumbName}`;
      return {
        path: r.path,
        url,
        thumbnailUrl: thumbUrl,
        width: r.width,
        height: r.height,
        seedUsed: r.seedUsed,
        quality: r.quality,
      };
    })
  );

  generationResults.set(taskId, {
    success: true,
    results: resultsWithURLs,
    generationMs,
    modelUsed: response.modelUsed,
    steps,
  });

  activeTasks.delete(taskId);

  await logEvent({
    category: "tryon",
    level: "info",
    message: `Task ${taskId} completed: ${resultsWithURLs.length} result(s)`,
    durationMs: generationMs,
    modelUsed: response.modelUsed,
    vramMB: body.hardware.vramAvailableMB,
    gpuInfo: body.hardware.gpu ?? undefined,
  });

  // Auto-cleanup of temp files older than 1 hour (best-effort)
  void cleanupOldTempFiles();
}

async function cleanupOldTempFiles() {
  try {
    const entries = await fs.readdir(TEMP_ROOT).catch(() => []);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const entry of entries) {
      const p = path.join(TEMP_ROOT, entry);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs < cutoff) {
          await fs.unlink(p);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
