/**
 * External Text-LLM Helper
 *
 * Provides text-only LLM access (translation, prompt refinement) through
 * whichever external provider is configured.
 *
 * Provider priority (when multiple are configured):
 *   1. NVIDIA NIM  — most reliable, generous free tier, no rate limits in practice
 *   2. OpenRouter  — fallback if NVIDIA not configured (free tier has limits)
 *   3. (caller falls back to z-ai if no external provider)
 *
 * Setup (set at least one):
 *   NVIDIA_API_KEY  = nvapi-...           (recommended — get from build.nvidia.com)
 *   NVIDIA_MODEL    = nvidia/nemotron-3-ultra-550b-a55b   (default)
 *   OPENROUTER_API_KEY = sk-or-...        (fallback)
 *   OPENROUTER_MODEL   = nvidia/nemotron-3-ultra-550b-a55b:free   (default)
 */

export type LLMProvider = "nvidia" | "openrouter";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Read an env var safely.
 */
function readEnv(name: string): string {
  if (typeof process === "undefined") return "";
  return process.env?.[name]?.trim() ?? "";
}

/**
 * Determine which external LLM provider is configured.
 * Returns null if neither is configured (caller should fall back to z-ai).
 */
export function pickBestLLMProvider(): LLMProvider | null {
  if (readEnv("NVIDIA_API_KEY") && readEnv("NVIDIA_MODEL")) {
    return "nvidia";
  }
  if (readEnv("OPENROUTER_API_KEY") && readEnv("OPENROUTER_MODEL")) {
    return "openrouter";
  }
  return null;
}

export function isExternalLLMAvailable(): boolean {
  return pickBestLLMProvider() !== null;
}

/**
 * Send a chat completion to NVIDIA NIM API.
 * NVIDIA's endpoint is OpenAI-compatible, but uses /v1/chat/completions.
 */
async function nvidiaChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: LLMOptions = {}
): Promise<string> {
  const apiKey = readEnv("NVIDIA_API_KEY");
  const model = options.model || readEnv("NVIDIA_MODEL");
  if (!apiKey || !model) {
    throw new Error("NVIDIA_API_KEY or NVIDIA_MODEL not set");
  }

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 400,
      top_p: 0.7,
      stream: false,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NVIDIA ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`NVIDIA: ${data.error.message ?? "unknown error"}`);
  }

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Send a chat completion to OpenRouter (fallback).
 * OpenRouter is OpenAI-compatible at https://openrouter.ai/api/v1/chat/completions.
 */
async function openrouterChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: LLMOptions = {}
): Promise<string> {
  const apiKey = readEnv("OPENROUTER_API_KEY");
  const model = options.model || readEnv("OPENROUTER_MODEL");
  if (!apiKey || !model) {
    throw new Error("OPENROUTER_API_KEY or OPENROUTER_MODEL not set");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "AI Clothing Studio",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 256,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`OpenRouter: ${data.error.message ?? "unknown error"}`);
  }

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Generic external LLM call — picks NVIDIA first, then OpenRouter.
 * Throws if neither is configured or both fail.
 */
export async function externalLLMChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: LLMOptions = {}
): Promise<{ text: string; provider: LLMProvider }> {
  const provider = pickBestLLMProvider();
  if (!provider) {
    throw new Error("No external LLM provider configured");
  }

  // Try primary provider first
  if (provider === "nvidia") {
    try {
      const text = await nvidiaChat(messages, options);
      return { text, provider: "nvidia" };
    } catch (e) {
      console.warn("[external-llm] NVIDIA failed, trying OpenRouter fallback:", e);
      // Try fallback if available
      if (readEnv("OPENROUTER_API_KEY") && readEnv("OPENROUTER_MODEL")) {
        const text = await openrouterChat(messages, options);
        return { text, provider: "openrouter" };
      }
      throw e;
    }
  }

  if (provider === "openrouter") {
    const text = await openrouterChat(messages, options);
    return { text, provider: "openrouter" };
  }

  throw new Error(`Unknown provider: ${provider satisfies never}`);
}

/**
 * Translate a garment description (any language) into concise English
 * suitable for an AI image-edit prompt. Preserves all visual details.
 *
 * Returns the original text if no external LLM is configured or if
 * translation fails — caller should fall back to z-ai.
 */
export async function translateGarmentDescription(
  description: string,
  signal?: AbortSignal
): Promise<string> {
  if (!description.trim()) return description;
  if (!isExternalLLMAvailable()) return description;

  const startMs = Date.now();
  try {
    const { text, provider } = await externalLLMChat(
      [
        {
          role: "system",
          content:
            "You are a professional fashion translator. Translate the user's garment description into concise English for an AI image editing prompt. Preserve all visual details (color, fabric, pattern, shape, collar, sleeves, buttons). Output ONLY the English translation — no explanations, no markdown, no quotes.",
        },
        { role: "user", content: description },
      ],
      { temperature: 0.2, maxTokens: 400, signal }
    );
    if (text && text !== description) {
      console.log(
        `[external-llm:${provider}] Translated in ${Date.now() - startMs}ms: "${description.slice(0, 40)}..." → "${text.slice(0, 60)}..."`
      );
    }
    return text || description;
  } catch (e) {
    console.warn("[external-llm] Translation failed:", e);
    return description; // graceful fallback
  }
}

/**
 * Refine a try-on prompt (text-only) — used before sending the prompt
 * to the image-edit model. Helps reduce failed generations by catching
 * unsafe wording early.
 */
export async function refineTryOnPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  if (!isExternalLLMAvailable()) return prompt;

  try {
    const { text, provider } = await externalLLMChat(
      [
        {
          role: "system",
          content:
            "You refine prompts for a virtual try-on AI image editor. Clean up the user's prompt: remove any inappropriate wording (skin, nudity, body exposure, lingerie, swimwear — describe as 'athletic top' or 'fitted top' instead), preserve all garment details (color, fabric, pattern, collar, sleeves, buttons), and make the wording crisp. Output ONLY the refined prompt, no preamble.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 600, signal }
    );
    if (text) {
      console.log(`[external-llm:${provider}] Refined prompt (${text.length} chars)`);
    }
    return text || prompt;
  } catch (e) {
    console.warn("[external-llm] Prompt refinement failed:", e);
    return prompt;
  }
}

// Backward-compat re-exports for the old module name (openrouter-vlm).
// These let existing imports keep working without code changes.
export const isOpenRouterAvailable = isExternalLLMAvailable;
