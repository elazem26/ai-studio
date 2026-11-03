/**
 * DEPRECATED — use ./external-llm instead.
 *
 * This file is kept as a thin re-export for backward compatibility.
 * The actual implementation now lives in external-llm.ts, which supports
 * both NVIDIA NIM (preferred) and OpenRouter (fallback).
 *
 * New code should import from "./external-llm".
 */
export {
  translateGarmentDescription,
  refineTryOnPrompt,
  isExternalLLMAvailable as isOpenRouterAvailable,
  externalLLMChat,
  pickBestLLMProvider,
  type LLMProvider,
  type LLMOptions,
} from "./external-llm";
