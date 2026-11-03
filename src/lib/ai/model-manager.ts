/**
 * Model Manager — orchestrates all model adapters.
 *
 * Selects the best adapter based on:
 *  - Available AI providers (env vars: REPLICATE_API_TOKEN, OPENAI_API_KEY, FAL_KEY)
 *  - User override (model selection in Model Manager UI)
 *  - Available VRAM (from /api/gpu/status) — for local models
 *
 * Adding a new model:
 *   1. Create a new adapter implementing ModelAdapter (e.g. IDMVtonAdapter).
 *   2. Register it in this file's `known` array.
 *   3. Done. UI picks it up automatically.
 *
 * Provider priority (when multiple are configured):
 *   1. Replicate (best try-on quality — purpose-built models)
 *   2. fal.ai (try-on specialized, fast)
 *   3. OpenAI gpt-image-1 (general image-edit fallback)
 *   4. z-ai (built-in default, always available)
 *   5. CatVTON local (only if Python backend running)
 */

import type { ModelAdapter, ModelInfo, HardwarePreference } from "./model-adapter";
import { CatVTONAdapter } from "./catvton-adapter";
import { CloudAIAdapter } from "./cloud-ai-adapter";
import { ReplicateTryOnAdapter } from "./providers/replicate-adapter";
import { OpenAIImageAdapter } from "./providers/openai-adapter";
import { pickBestProvider, type ProviderId } from "./providers/keys";

// Lazy-initialized adapters
const adapters = new Map<string, ModelAdapter>();
let registryBuilt = false;

function buildRegistry(): void {
  if (registryBuilt) return;
  // Register every adapter available to the system.
  // To add a new model: register here.
  // Order matters: the FIRST registered becomes the default selection.
  const known: ModelAdapter[] = [
    new ReplicateTryOnAdapter(),  // ← best for try-on (if REPLICATE_API_TOKEN set)
    new OpenAIImageAdapter(),     // ← alternative (if OPENAI_API_KEY set)
    new CloudAIAdapter(),         // ← default z-ai (always available)
    new CatVTONAdapter(),         // ← optional local Python backend
    // new IDMVtonAdapter(),    // ← future
    // new OOTDiffusionAdapter(), // ← future
  ];
  for (const a of known) {
    adapters.set(a.modelId, a);
  }
  registryBuilt = true;
}

export function getAllModelIds(): string[] {
  buildRegistry();
  return Array.from(adapters.keys());
}

export function getAdapter(id: string): ModelAdapter | null {
  buildRegistry();
  return adapters.get(id) ?? null;
}

export async function listAllModels(): Promise<ModelInfo[]> {
  buildRegistry();
  const list: ModelInfo[] = [];
  for (const a of adapters.values()) {
    list.push(await a.getInfo());
  }
  return list;
}

export interface HardwareSnapshot {
  preference: HardwarePreference;
  vramAvailableMB: number;
  cudaAvailable: boolean;
  cpu: string | null;
  ramTotalGB: number | null;
  gpu: string | null;
  vramTotalMB: number | null;
}

/**
 * Map a provider id to the corresponding adapter model id.
 */
const PROVIDER_TO_ADAPTER: Record<ProviderId, string> = {
  replicate: "replicate-tryon",
  openai: "openai-image",
  fal: "replicate-tryon",
  openrouter: "cloud-ai", // OpenRouter only does text LLM — used for translation in cloud-ai
  nvidia: "cloud-ai",     // NVIDIA NIM only does text LLM — used for translation in cloud-ai
  zai: "cloud-ai",
};

/**
 * Auto-select the best model based on configured providers + hardware.
 *
 * Selection logic:
 *   1. If AI_PROVIDER env var is set, use that (if available).
 *   2. Else, pick the best provider via pickBestProvider() (replicate → fal → openai → zai).
 *   3. Map provider id to adapter id.
 *   4. Fall back to cloud-ai (z-ai) if anything goes wrong.
 */
export async function selectBestModel(hw: HardwareSnapshot): Promise<string> {
  buildRegistry();
  const bestProvider = pickBestProvider();
  const adapterId = PROVIDER_TO_ADAPTER[bestProvider] ?? "cloud-ai";
  // Verify the adapter is registered
  if (adapters.has(adapterId)) {
    return adapterId;
  }
  return "cloud-ai";
}

/**
 * Get model information from a registered adapter.
 */
export async function getModelInfo(id: string): Promise<ModelInfo | null> {
  const a = getAdapter(id);
  if (!a) return null;
  return a.getInfo();
}
