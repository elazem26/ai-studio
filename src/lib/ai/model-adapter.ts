/**
 * Model Adapter Interface
 *
 * Defines the contract every virtual try-on model backend must implement.
 * This decouples the application from any specific model — new models
 * (CatVTON, IDM-VTON, OOTDiffusion, etc.) can be plugged in without
 * touching the rest of the app.
 */

export type ModelCategory =
  | "virtual_tryon"
  | "upscaler"
  | "segmentation"
  | "pose";

export type HardwarePreference = "cuda_high" | "cuda_mid" | "cuda_low" | "cpu";

export interface ModelCapabilities {
  /** Max output resolution */
  maxResolution: number;
  /** Min VRAM required in MB */
  vramRequiredMB: number;
  /** Whether it supports multiple results per call (batch) */
  supportsBatch: boolean;
  /** Whether it can run on CPU */
  supportsCPU: boolean;
  /** List of garment types it handles best */
  garmentStrengths: ("tops" | "bottoms" | "dress" | "outerwear" | "full")[];
  /** Whether it accepts a fixed seed */
  supportsSeed: boolean;
  /** Average generation time in ms (at recommended settings) */
  avgGenerationMs: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
  version: string;
  category: ModelCategory;
  /** Repository URL on HuggingFace Hub */
  huggingfaceRepo: string;
  sizeGB: number;
  vramRequiredGB: number;
  ramRequiredGB: number;
  license: string;
  capabilities: ModelCapabilities;
}

export interface TryOnRequest {
  /** Source person image — server-side path */
  sourcePath: string;
  /** Garment image — server-side path. Optional when using description only. */
  garmentPath: string;
  /** Optional text description (used when no garment image is provided) */
  garmentDescription?: string;
  /** Effective settings resolved by getEffectiveSettings */
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
  /** Hardware snapshot at call time */
  hardware: {
    preference: HardwarePreference;
    vramAvailableMB: number;
    cudaAvailable: boolean;
  };
  /** Optional progress reporter */
  onProgress?: (step: TryOnProgressStep) => void;
  /** Optional cancellation signal */
  signal?: AbortSignal;
}

export interface TryOnProgressStep {
  stage:
    | "validating"
    | "analyzing"
    | "segmenting"
    | "parsing"
    | "pose"
    | "garment"
    | "generating"
    | "postProcessing"
    | "colorMatching"
    | "detailEnhance"
    | "qualityCheck"
    | "finalizing";
  percent: number;
  /** Friendly key for the stage label */
  labelKey: string;
  /** Optional technical detail */
  detail?: string;
}

export interface QualityCheckResult {
  score: number; // 0-100
  issues: Array<{
    type:
      | "faceDistortion"
      | "handDistortion"
      | "bodyDistortion"
      | "skinToneChange"
      | "backgroundDistortion"
      | "artifacts"
      | "lostDetails"
      | "garmentMismatch";
    severity: "low" | "medium" | "high";
  }>;
}

export interface TryOnResultItem {
  /** Server-side output path */
  path: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Seed actually used (in case request.seed was null) */
  seedUsed: string;
  /** Quality check (optional) */
  quality?: QualityCheckResult;
}

export interface TryOnResponse {
  success: boolean;
  results?: TryOnResultItem[];
  errorKey?: string;
  errorMessage?: string;
  /** Time spent in the model, in ms */
  generationMs?: number;
  /** Model id used */
  modelUsed?: string;
}

/**
 * The ModelAdapter interface — every model must implement this.
 *
 * Lifecycle:
 *   1. getInfo() — get metadata (always available, even if not installed)
 *   2. isInstalled() — check if model files are on disk
 *   3. install(progress?) — download from HuggingFace (one-time, optional)
 *   4. load() — load model into VRAM/RAM
 *   5. generate(request) — run try-on
 *   6. unload() — release VRAM
 */
export interface ModelAdapter {
  readonly modelId: string;
  getInfo(): Promise<ModelInfo>;
  isInstalled(): Promise<boolean>;
  install(onProgress?: (p: { percent: number; message: string }) => void): Promise<boolean>;
  load(): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  generate(request: TryOnRequest): Promise<TryOnResponse>;
}
