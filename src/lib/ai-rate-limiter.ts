/**
 * AI API Rate Limiter + Cache
 *
 * Prevents 429 "Too many requests" errors by:
 * 1. Throttling: minimum 3 seconds between AI API calls
 * 2. Caching: if the same prompt was used recently, return cached result
 * 3. Health check: track whether the API is currently available
 */

// Minimum delay between API calls (ms)
const MIN_DELAY = 3000;

// Cache TTL (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Track last API call time
let lastCallTime = 0;

// Track API health
let apiHealthy = true;
let lastHealthCheck = 0;

// Cache: prompt -> { result, timestamp }
const cache = new Map<string, { result: any; timestamp: number }>();

/**
 * Wait until enough time has passed since the last API call.
 * This prevents rapid-fire requests that trigger 429.
 */
export async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_DELAY) {
    const wait = MIN_DELAY - elapsed;
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallTime = Date.now();
}

/**
 * Get cached result for a prompt (if still valid).
 */
export function getCached(prompt: string): any | null {
  const entry = cache.get(prompt);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(prompt);
    return null;
  }
  return entry.result;
}

/**
 * Cache a result for a prompt.
 */
export function setCached(prompt: string, result: any): void {
  cache.set(prompt, { result, timestamp: Date.now() });
}

/**
 * Check if the AI API is currently healthy (not rate-limited).
 * Checks at most once per 30 seconds to avoid extra requests.
 */
export function isApiHealthy(): boolean {
  // If we checked recently, return cached result
  if (Date.now() - lastHealthCheck < 30000) {
    return apiHealthy;
  }
  return apiHealthy; // Return last known state
}

/**
 * Mark the API as unhealthy (after a 429 error).
 */
export function markUnhealthy(): void {
  apiHealthy = false;
  lastHealthCheck = Date.now();
}

/**
 * Mark the API as healthy (after a successful call).
 */
export function markHealthy(): void {
  apiHealthy = true;
  lastHealthCheck = Date.now();
}

/**
 * Generate a cache key from a prompt + params.
 */
export function cacheKey(prompt: string, extra?: any): string {
  return `${prompt}::${JSON.stringify(extra || {})}`;
}
