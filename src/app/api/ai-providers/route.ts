import { NextResponse } from "next/server";
import { listProviders, pickBestProvider, type ProviderId } from "@/lib/ai/providers/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-providers
 *
 * Returns the list of all supported AI providers with their current
 * availability status. Used by the Settings UI to show which providers
 * are configured.
 *
 * Response shape:
 *   {
 *     providers: ProviderInfo[],
 *     best: ProviderId,
 *     override: ProviderId | null,
 *     activeAdapter: string  // adapter id that will be used
 *   }
 */
export async function GET() {
  const providers = listProviders();
  const best = pickBestProvider();
  const override =
    (typeof process !== "undefined" && process.env?.AI_PROVIDER) || null;

  // Map provider id to adapter id (mirrors model-manager)
  const PROVIDER_TO_ADAPTER: Record<ProviderId, string> = {
    replicate: "replicate-tryon",
    openai: "openai-image",
    fal: "replicate-tryon",
    openrouter: "cloud-ai", // OpenRouter only does text LLM — plugged into cloud-ai for translation
    nvidia: "cloud-ai",     // NVIDIA NIM only does text LLM — plugged into cloud-ai for translation
    zai: "cloud-ai",
  };

  return NextResponse.json({
    providers,
    best,
    override: override || null,
    activeAdapter: PROVIDER_TO_ADAPTER[best] ?? "cloud-ai",
    mapping: PROVIDER_TO_ADAPTER,
  });
}
