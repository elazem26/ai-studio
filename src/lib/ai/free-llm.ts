/**
 * Unified Free LLM Provider Client (9 providers + built-in ZAI safety net)
 *
 * Original Group 1:
 *   1. Groq           (free, 14,400 req/day)         https://console.groq.com/keys
 *   2. Google Gemini  (free, 6M tokens/day)          https://aistudio.google.com/apikey
 *   3. OpenRouter     (free + paid models)           https://openrouter.ai/keys
 *
 * Group 2 (added — all free, refreshable tiers):
 *   4. Cerebras       (~1M tokens/day, ultra-fast)   https://cloud.cerebras.ai
 *   5. Mistral        (Experiment ~500K-1B/month)    https://console.mistral.ai/api-keys
 *   6. Cohere         (Trial 1,000 calls/month)      https://dashboard.cohere.com/api-keys
 *   7. GitHub Models  (rate-limited free tier)       https://github.com/settings/tokens
 *   8. Cloudflare AI  (10,000 Neurons/day)           https://dash.cloudflare.com → AI Gateway
 *
 * Safety net (always available in Z.ai sandbox):
 *   9. ZAI SDK         built-in — no API key needed
 *
 * Keys are read from the DB Setting table first (key: "llm:<provider>_key"),
 * then fall back to environment variables (see PROVIDER_ENV_VARS map).
 * Cloudflare additionally needs an account_id stored at "llm:cloudflare_account_id".
 *
 * Features:
 *   - Smart circuit breaker: 3 consecutive failures → 5-min cooldown
 *   - Performance tracking per provider
 *   - Automatic fallback to next provider
 *   - ZAI SDK always tried last as the safety net
 */

import { db } from "@/lib/db";

export type LLMProvider =
  | "groq"
  | "google"
  | "openrouter"
  | "cerebras"
  | "mistral"
  | "cohere"
  | "github"
  | "cloudflare"
  | "zai";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  preferProvider?: LLMProvider; // hint: which provider to try first
}

export interface LLMResponse {
  text: string;
  provider: LLMProvider;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  responseTimeMs?: number;
}

/** Default free-tier models for each provider */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  groq: "llama-3.1-8b-instant",
  google: "gemini-2.0-flash-exp",
  openrouter: "meta-llama/llama-3.1-8b-instruct:free",
  cerebras: "llama3.1-8b",
  mistral: "mistral-small-latest",
  cohere: "command-r-plus",
  github: "openai/gpt-4o-mini", // ⚠️ service retired 2026-07-30
  cloudflare: "@cf/meta/llama-3.1-8b-instruct",
  zai: "glm-4",
};

/**
 * Environment variable name for each provider (used as fallback when DB has no key).
 * GitHub Models uses a GitHub PAT (GITHUB_TOKEN), not an "_API_KEY" suffix.
 */
const PROVIDER_ENV_VARS: Record<LLMProvider, string> = {
  groq: "GROQ_API_KEY",
  google: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  github: "GITHUB_TOKEN",
  cloudflare: "CLOUDFLARE_API_TOKEN",
  zai: "ZAI_API_KEY",
};

/** Documentation URLs for each provider (shown in admin UI). */
const PROVIDER_DOCS_URLS: Record<LLMProvider, string> = {
  groq: "https://console.groq.com/keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
  cerebras: "https://cloud.cerebras.ai",
  mistral: "https://console.mistral.ai/api-keys",
  cohere: "https://dashboard.cohere.com/api-keys",
  github: "https://github.com/settings/tokens (needs read:models scope)",
  cloudflare: "https://dash.cloudflare.com → My Profile → API Tokens",
  zai: "https://z.ai (built-in to sandbox)",
};

/** Human-readable description of each provider's free tier. */
const PROVIDER_FREE_TIER_INFO: Record<LLMProvider, string> = {
  groq: "مجاني — 14,400 طلب/يوم (Llama 3.1)",
  google: "مجاني — 6M tokens/يوم (Gemini 2.0 Flash)",
  openrouter: "نماذج مجانية + خيارات مدفوعة",
  cerebras: "مجاني — ~1M tokens/يوم (الأسرع عالمياً)",
  mistral: "تجريبي — ~500K-1B tokens/شهر",
  cohere: "تجريبي — 1,000 استدعاء/شهر (Command-R+)",
  github: "⚠️ متقاعد (2026-07-30) — احذف المفتاح أو انتقل لـAzure AI Foundry",
  cloudflare: "مجاني — 10,000 Neurons/يوم",
  zai: "مدمج في السانبوكس بلا مفتاح",
};

// ============================================================
// CIRCUIT BREAKER + PERFORMANCE TRACKING (in-memory)
// ============================================================

interface ProviderStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalResponseTimeMs: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: number;
}

const ALL_PROVIDERS: LLMProvider[] = [
  "groq", "google", "openrouter",
  "cerebras", "mistral", "cohere", "github", "cloudflare",
  "zai",
];

function freshStats(): ProviderStats {
  return {
    totalCalls: 0,
    successCount: 0,
    failureCount: 0,
    totalResponseTimeMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    cooldownUntil: 0,
  };
}

const providerStats: Record<LLMProvider, ProviderStats> = {
  groq: freshStats(),
  google: freshStats(),
  openrouter: freshStats(),
  cerebras: freshStats(),
  mistral: freshStats(),
  cohere: freshStats(),
  github: freshStats(),
  cloudflare: freshStats(),
  zai: freshStats(),
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

export function getProviderStats(provider: LLMProvider): ProviderStats & {
  successRate: number; avgResponseTimeMs: number; inCooldown: boolean;
} {
  const s = providerStats[provider];
  return {
    ...s,
    successRate: s.totalCalls > 0 ? (s.successCount / s.totalCalls) * 100 : 0,
    avgResponseTimeMs: s.successCount > 0 ? s.totalResponseTimeMs / s.successCount : 0,
    inCooldown: Date.now() < s.cooldownUntil,
  };
}

export function getAllProviderStats() {
  const out: Record<string, ReturnType<typeof getProviderStats>> = {};
  for (const p of ALL_PROVIDERS) out[p] = getProviderStats(p);
  return out;
}

function recordSuccess(provider: LLMProvider, responseTimeMs: number) {
  const s = providerStats[provider];
  s.totalCalls++;
  s.successCount++;
  s.consecutiveFailures = 0;
  s.lastSuccessAt = Date.now();
  s.totalResponseTimeMs += responseTimeMs;
  s.cooldownUntil = 0;
}

function recordFailure(provider: LLMProvider, error: string) {
  const s = providerStats[provider];
  s.totalCalls++;
  s.failureCount++;
  s.consecutiveFailures++;
  s.lastFailureAt = Date.now();
  s.lastErrorMessage = error;
  if (s.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    s.cooldownUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(`[llm] Provider ${provider} cooldown ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min — ${s.consecutiveFailures} consecutive failures`);
  }
}

function isInCooldown(provider: LLMProvider): boolean {
  return Date.now() < providerStats[provider].cooldownUntil;
}

// ============================================================
// API KEY MANAGEMENT (DB-backed, admin-configurable)
// ============================================================

async function getSetting(key: string): Promise<string> {
  const setting = await db.setting.findUnique({ where: { key } }).catch(() => null);
  return setting?.value?.trim() || "";
}

async function getApiKey(provider: LLMProvider): Promise<string> {
  const settingKey = `llm:${provider}_key`;
  const dbVal = await getSetting(settingKey);
  if (dbVal) return dbVal;
  // Fallback to env var
  const envName = PROVIDER_ENV_VARS[provider];
  return process.env?.[envName]?.trim() || "";
}

/** Cloudflare needs an account_id in addition to the api_token. */
async function getCloudflareAccountId(): Promise<string> {
  const dbVal = await getSetting("llm:cloudflare_account_id");
  if (dbVal) return dbVal;
  return process.env?.["CLOUDFLARE_ACCOUNT_ID"]?.trim() || "";
}

export async function isProviderConfigured(provider: LLMProvider): Promise<boolean> {
  if (provider === "zai") return true;
  if (provider === "cloudflare") {
    const [token, accountId] = await Promise.all([getApiKey("cloudflare"), getCloudflareAccountId()]);
    return !!(token && accountId && token.length > 10 && accountId.length > 5);
  }
  const key = await getApiKey(provider);
  return !!key && key.length > 10;
}

export async function getConfiguredProviders(): Promise<LLMProvider[]> {
  const providers: LLMProvider[] = [];
  for (const p of ALL_PROVIDERS) {
    if (p === "zai") continue; // zai is always pushed at the end of callLLM
    if (await isProviderConfigured(p)) providers.push(p);
  }
  return providers;
}

/** Get human-readable info for UI display. */
export function getProviderInfo(provider: LLMProvider) {
  return {
    docsUrl: PROVIDER_DOCS_URLS[provider],
    envVar: PROVIDER_ENV_VARS[provider],
    freeTierInfo: PROVIDER_FREE_TIER_INFO[provider],
    defaultModel: DEFAULT_MODELS[provider],
  };
}

// ============================================================
// PROVIDER CALLS
// ============================================================

/** Shared helper for OpenAI-compatible providers (Cerebras, Mistral, GitHub Models). */
async function callOpenAICompatible(
  provider: LLMProvider,
  messages: LLMMessage[],
  options: LLMOptions,
  apiKey: string,
  url: string,
): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS[provider];
  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`${provider} API error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    provider,
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

async function callGroq(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  return callOpenAICompatible("groq", messages, options, apiKey, "https://api.groq.com/openai/v1/chat/completions");
}

async function callOpenRouter(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.openrouter;
  const start = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://ai-studio.local",
      "X-Title": "AI Clothing Studio",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    provider: "openrouter",
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

async function callGoogle(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.google;
  const start = Date.now();
  const contents = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const systemPrompt = messages.find(m => m.role === "system")?.content || "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 2048,
      },
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Google AI error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  return {
    text: text.trim(),
    provider: "google",
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
    } : undefined,
  };
}

/** Cerebras — OpenAI-compatible, ultra-fast inference. */
async function callCerebras(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  return callOpenAICompatible("cerebras", messages, options, apiKey, "https://api.cerebras.ai/v1/chat/completions");
}

/** Mistral — OpenAI-compatible endpoint. */
async function callMistral(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  return callOpenAICompatible("mistral", messages, options, apiKey, "https://api.mistral.ai/v1/chat/completions");
}

/**
 * Call GitHub Models — uses GitHub PAT.
 * ⚠️ DEPRECATED: GitHub Models was fully retired on July 30, 2026.
 * The endpoint no longer performs inference — it returns a generic "OK"
 * placeholder. Saved keys are kept but will fail; the circuit breaker
 * will skip this provider after 3 attempts. Replacement: Azure AI Foundry
 * (requires Azure subscription, no longer free for personal use).
 */
async function callGitHub(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.github;
  const start = Date.now();
  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "User-Agent": "ai-clothing-studio/1.0",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`GitHub Models error ${res.status}: ${err.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  // GitHub Models retired: returns text/plain "OK" instead of JSON.
  if (!ct.includes("application/json")) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub Models returned non-JSON (content-type: ${ct}). ` +
      `Service was retired on 2026-07-30 — please remove the GitHub key ` +
      `or migrate to Azure AI Foundry. Body: ${body.slice(0, 100)}`
    );
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    provider: "github",
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/** Cohere V2 chat — OpenAI-style request, custom response shape. */
async function callCohere(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.cohere;
  const start = Date.now();
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Cohere error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  // Cohere V2 returns message.content as array of { type, text }
  const contentArr = data.message?.content;
  const text = Array.isArray(contentArr)
    ? contentArr.map((c: any) => c?.text || "").join("")
    : (typeof contentArr === "string" ? contentArr : "");
  return {
    text: text.trim(),
    provider: "cohere",
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usage?.tokens ? {
      promptTokens: data.usage.tokens.input_tokens,
      completionTokens: data.usage.tokens.output_tokens,
      totalTokens: (data.usage.tokens.input_tokens || 0) + (data.usage.tokens.output_tokens || 0),
    } : undefined,
  };
}

/** Cloudflare Workers AI — OpenAI-compatible endpoint, needs account_id + api_token. */
async function callCloudflare(messages: LLMMessage[], options: LLMOptions, apiKey: string): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.cloudflare;
  const accountId = await getCloudflareAccountId();
  if (!accountId) throw new Error("Cloudflare account_id missing — set llm:cloudflare_account_id in DB or CLOUDFLARE_ACCOUNT_ID env");
  const start = Date.now();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Cloudflare AI error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    provider: "cloudflare",
    model,
    responseTimeMs: Date.now() - start,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/** ZAI SDK — built-in fallback, always available in Z.ai sandbox. */
async function callZAI(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse> {
  const model = options.model || DEFAULT_MODELS.zai;
  const start = Date.now();
  const ZAIModule = await import("z-ai-web-dev-sdk");
  const zai = await ZAIModule.default.create();
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: "disabled" } as any,
  } as any);
  return {
    text: completion.choices?.[0]?.message?.content?.trim() || "",
    provider: "zai",
    model: completion.model || model,
    responseTimeMs: Date.now() - start,
    usage: completion.usage ? {
      promptTokens: (completion.usage as any).prompt_tokens,
      completionTokens: (completion.usage as any).completion_tokens,
      totalTokens: (completion.usage as any).total_tokens,
    } : undefined,
  };
}

// ============================================================
// MAIN ENTRY: smart fallback with circuit breaker
// ============================================================

export async function callLLM(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
  const configured = await getConfiguredProviders();
  if (!configured.includes("zai")) configured.push("zai");

  // Build priority order: preferProvider first, then configured, then zai (always last)
  const order: LLMProvider[] = [];
  if (options.preferProvider && configured.includes(options.preferProvider)) {
    order.push(options.preferProvider);
  }
  for (const p of configured) {
    if (!order.includes(p)) order.push(p);
  }
  // Move zai to the end as the safety net
  order.splice(order.indexOf("zai"), 1);
  order.push("zai");

  let lastError: Error | null = null;
  for (const provider of order) {
    if (provider !== "zai" && isInCooldown(provider)) {
      console.log(`[llm] Skipping ${provider} — cooldown until ${new Date(providerStats[provider].cooldownUntil).toISOString()}`);
      continue;
    }
    try {
      const apiKey = provider === "zai" ? "" : await getApiKey(provider);
      let response: LLMResponse;
      switch (provider) {
        case "groq":
          if (!apiKey) continue;
          response = await callGroq(messages, options, apiKey);
          break;
        case "google":
          if (!apiKey) continue;
          response = await callGoogle(messages, options, apiKey);
          break;
        case "openrouter":
          if (!apiKey) continue;
          response = await callOpenRouter(messages, options, apiKey);
          break;
        case "cerebras":
          if (!apiKey) continue;
          response = await callCerebras(messages, options, apiKey);
          break;
        case "mistral":
          if (!apiKey) continue;
          response = await callMistral(messages, options, apiKey);
          break;
        case "cohere":
          if (!apiKey) continue;
          response = await callCohere(messages, options, apiKey);
          break;
        case "github":
          if (!apiKey) continue;
          response = await callGitHub(messages, options, apiKey);
          break;
        case "cloudflare":
          if (!apiKey) continue;
          response = await callCloudflare(messages, options, apiKey);
          break;
        case "zai":
          response = await callZAI(messages, options);
          break;
        default:
          continue;
      }
      recordSuccess(provider, response.responseTimeMs || 0);
      return response;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      recordFailure(provider, errMsg);
      console.warn(`[llm] Provider ${provider} failed:`, errMsg);
      lastError = e;
    }
  }
  throw lastError || new Error("No LLM provider available");
}

// ============================================================
// API KEY MANAGEMENT (DB-backed, admin-settable)
// ============================================================

/** Save API key for a provider (admin only — caller must verify admin) */
export async function setApiKey(provider: LLMProvider, key: string): Promise<void> {
  const settingKey = `llm:${provider}_key`;
  await db.setting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value: key },
    update: { value: key },
  });
  providerStats[provider].cooldownUntil = 0;
  providerStats[provider].consecutiveFailures = 0;
}

/** Save Cloudflare account_id (separate setting — admin only) */
export async function setCloudflareAccountId(accountId: string): Promise<void> {
  await db.setting.upsert({
    where: { key: "llm:cloudflare_account_id" },
    create: { key: "llm:cloudflare_account_id", value: accountId },
    update: { value: accountId },
  });
}

/** Get masked API key for display (show only last 4 chars) */
export async function getMaskedApiKey(provider: LLMProvider): Promise<string> {
  const key = await getApiKey(provider);
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return "•".repeat(key.length - 4) + key.slice(-4);
}

/** Get masked Cloudflare account_id for display */
export async function getMaskedCloudflareAccountId(): Promise<string> {
  const id = await getCloudflareAccountId();
  if (!id) return "";
  if (id.length <= 8) return "•".repeat(id.length);
  return id.slice(0, 4) + "•".repeat(id.length - 8) + id.slice(-4);
}

/** Manually reset a provider's cooldown (admin can force-reenable) */
export function resetProviderCooldown(provider: LLMProvider): void {
  providerStats[provider].cooldownUntil = 0;
  providerStats[provider].consecutiveFailures = 0;
}

/** Manually reset ALL providers' cooldowns */
export function resetAllCooldowns(): void {
  for (const p of ALL_PROVIDERS) resetProviderCooldown(p);
}
