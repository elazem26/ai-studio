/**
 * Pollinations.ai — Free image generation API (no API key required for basic use)
 *
 * Documentation: https://pollinations.ai
 *
 * Usage:
 *   - GET https://image.pollinations.ai/prompt/{prompt}?width=W&height=H&model=M&seed=S
 *   - Returns: image/jpeg directly
 *   - Free tier: unlimited requests (with rate limiting)
 *
 * For higher limits and authenticated generation, register at https://pollinations.ai
 */

export interface PollinationsOptions {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string; // "flux", "flux-realism", "flux-anime", "turbo", etc.
  nologo?: boolean; // remove pollinations watermark
  enhance?: boolean; // AI-enhance the prompt
  negative?: string; // negative prompt
}

/**
 * Generate an image URL via Pollinations.ai
 * Returns the direct URL to the generated image.
 */
export function generateImageUrl(options: PollinationsOptions): string {
  const {
    prompt,
    width = 1024,
    height = 1024,
    seed,
    model = "flux",
    nologo = true,
    enhance = true,
    negative,
  } = options;

  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams();
  params.set("width", String(width));
  params.set("height", String(height));
  params.set("model", model);
  if (nologo) params.set("nologo", "true");
  if (enhance) params.set("enhance", "true");
  if (seed !== undefined) params.set("seed", String(seed));
  if (negative) params.set("negative", negative);

  return `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
}

/**
 * Generate an image and return as base64 data URL.
 * Fetches the image bytes and encodes them.
 */
export async function generateImageBase64(options: PollinationsOptions): Promise<{
  dataUrl: string;
  url: string;
  size: number;
}> {
  const url = generateImageUrl(options);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Pollinations API error ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  // Use Buffer (Node.js) for base64 encoding
  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return {
    dataUrl: `data:${contentType};base64,${base64}`,
    url,
    size: buffer.byteLength,
  };
}

/** Available Pollinations models */
export const POLLINATIONS_MODELS = [
  { id: "flux", label: "Flux (default, best quality)", recommended: true },
  { id: "flux-realism", label: "Flux Realism (photorealistic)" },
  { id: "flux-anime", label: "Flux Anime" },
  { id: "flux-3d", label: "Flux 3D" },
  { id: "turbo", label: "Turbo (fastest)" },
  { id: "any-dark", label: "Any Dark" },
];
