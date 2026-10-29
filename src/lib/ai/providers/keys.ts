/**
 * AI Provider Keys Manager
 *
 * Centralized registry of all supported AI providers and their API keys.
 * Keys are read from environment variables at runtime — never stored in DB.
 *
 * To switch providers, the user sets one of:
 *   - REPLICATE_API_TOKEN
 *   - OPENAI_API_KEY
 *   - FAL_KEY            (fal.ai — optional, also try-on specialized)
 *   - ZAI_API_KEY        (the default z-ai-web-dev-sdk, fallback)
 *
 * The model-manager picks the best available provider automatically.
 */

export type ProviderId =
  | "replicate"
  | "openai"
  | "fal"
  | "openrouter"
  | "nvidia"
  | "zai";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Env var name that holds the API key */
  envVar: string;
  /** True when the env var is set and non-empty */
  isAvailable: boolean;
  /** What this provider is best at */
  bestFor: string;
  /** Approximate cost per try-on (USD) */
  costPerCall: string;
  /** Try-on specialized (uses purpose-built models) vs general image-edit */
  tryOnSpecialized: boolean;
  /** Documentation URL */
  docsUrl: string;
}

/**
 * Read an env var safely — works in both Node and edge runtimes.
 */
function readEnv(name: string): string {
  if (typeof process === "undefined") return "";
  return process.env?.[name]?.trim() ?? "";
}

/**
 * List all known providers with their availability status.
 * Call this from the UI to show which providers are configured.
 */
export function listProviders(): ProviderInfo[] {
  return [
    {
      id: "replicate",
      name: "Replicate",
      envVar: "REPLICATE_API_TOKEN",
      isAvailable: !!readEnv("REPLICATE_API_TOKEN"),
      bestFor: "Virtual try-on (CatVTON, IDM-VTON, OOTDiffusion)",
      costPerCall: "$0.02 - $0.05",
      tryOnSpecialized: true,
      docsUrl: "https://replicate.com/account/api-tokens",
    },
    {
      id: "openai",
      name: "OpenAI",
      envVar: "OPENAI_API_KEY",
      isAvailable: !!readEnv("OPENAI_API_KEY"),
      bestFor: "Image edit + VLM verification (gpt-image-1 + GPT-4o)",
      costPerCall: "$0.04 - $0.17",
      tryOnSpecialized: false,
      docsUrl: "https://platform.openai.com/api-keys",
    },
    {
      id: "fal",
      name: "fal.ai",
      envVar: "FAL_KEY",
      isAvailable: !!readEnv("FAL_KEY"),
      bestFor: "Fast try-on + inpainting (CatVTON, IDM-VTON)",
      costPerCall: "$0.02 - $0.04",
      tryOnSpecialized: true,
      docsUrl: "https://fal.ai/dashboard/keys",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      envVar: "OPENROUTER_API_KEY",
      isAvailable: !!readEnv("OPENROUTER_API_KEY"),
      // Free-tier in some regions only allows text LLMs; vision/image models
      // are geo-blocked. Useful for translation / prompt-refinement only.
      bestFor: "Text LLM only (geo-blocked for vision in some regions)",
      costPerCall: "$0 (free tier) - $0.05",
      tryOnSpecialized: false,
      docsUrl: "https://openrouter.ai/keys",
    },
    {
      id: "nvidia",
      name: "NVIDIA NIM",
      envVar: "NVIDIA_API_KEY",
      isAvailable: !!readEnv("NVIDIA_API_KEY"),
      // Free tier with generous limits, no geo-blocking, reliable.
      // Has access to Nemotron-3-Ultra-550B and Nemotron-3-Super-120B
      // (text-only — no vision/image gen for this account tier).
      bestFor: "Text LLM (Nemotron-3-Ultra-550B) — translation, prompt refinement",
      costPerCall: "$0 (free tier)",
      tryOnSpecialized: false,
      docsUrl: "https://build.nvidia.com/profiler/api-keys",
    },
    {
      id: "zai",
      name: "Z.ai (default)",
      envVar: "ZAI_API_KEY",
      isAvailable: true, // z-ai-web-dev-sdk is the built-in default
      bestFor: "Built-in try-on pipeline (no extra signup)",
      costPerCall: "Free tier",
      tryOnSpecialized: false,
      docsUrl: "https://z.ai",
    },
  ];
}

/**
 * Get info for a single provider.
 */
export function getProviderInfo(id: ProviderId): ProviderInfo | undefined {
  return listProviders().find((p) => p.id === id);
}

/**
 * Pick the best available provider.
 * Priority order:
 *   1. Replicate (try-on specialized, best quality)
 *   2. fal.ai (try-on specialized, fast)
 *   3. OpenAI (general image-edit, high quality)
 *   4. z-ai (always available, fallback)
 *
 * Can be overridden by setting `AI_PROVIDER` env var to one of the ids.
 */
export function pickBestProvider(): ProviderId {
  const override = readEnv("AI_PROVIDER") as ProviderId | "" | undefined;
  if (override) {
    const info = getProviderInfo(override);
    if (info && info.isAvailable) return override;
    // fall through if override not available
  }

  const providers = listProviders();
  // Prefer specialized try-on providers first, then general
  const priority: ProviderId[] = ["replicate", "fal", "openai", "zai"];
  for (const id of priority) {
    const info = providers.find((p) => p.id === id);
    if (info?.isAvailable) return id;
  }
  return "zai"; // ultimate fallback
}

/**
 * Get the API key for a provider, or empty string if not set.
 */
export function getApiKey(provider: ProviderId): string {
  const info = getProviderInfo(provider);
  if (!info) return "";
  return readEnv(info.envVar);
}

/**
 * True if at least one external provider (replicate/openai/fal) is configured.
 */
export function hasExternalProvider(): boolean {
  return listProviders().some(
    (p) => p.id !== "zai" && p.isAvailable
  );
}
