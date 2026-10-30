"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type GenerationStage =
  | "idle"
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
  | "finalizing"
  | "complete"
  | "cancelled"
  | "error";

export interface GenerationStep {
  stage: GenerationStage;
  percent: number;
  label: string;
  /** Wall-clock timestamp (ms) when the step was recorded (optional). */
  ts?: number;
}

export interface QualityIssue {
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
}

interface TryOnState {
  isGenerating: boolean;
  stage: GenerationStage;
  percent: number;
  stageLabel: string;
  error: string | null;
  errorKey: string | null; // i18n key for friendly message
  /** Generation started at (ms) */
  startedAt: number | null;
  /** Total ms of last completed generation */
  lastDurationMs: number | null;
  /** Model used for last generation */
  modelUsed: string | null;
  /** Quality check issues (last result) */
  qualityIssues: QualityIssue[];
  qualityScore: number | null;
  /** Per-step log for developer mode */
  steps: GenerationStep[];
  /** Generation task id (so we can cancel) */
  taskId: string | null;

  start: () => void;
  updateStep: (step: GenerationStep) => void;
  setError: (errorKey: string, msg?: string) => void;
  cancel: () => void;
  complete: (info: {
    modelUsed: string;
    durationMs: number;
    qualityScore?: number;
    qualityIssues?: QualityIssue[];
  }) => void;
  reset: () => void;
}

export const useTryOnStore = create<TryOnState>()(
  persist(
    (set) => ({
      isGenerating: false,
      stage: "idle",
      percent: 0,
      stageLabel: "",
      error: null,
      errorKey: null,
      startedAt: null,
      lastDurationMs: null,
      modelUsed: null,
      qualityIssues: [],
      qualityScore: null,
      steps: [],
      taskId: null,

      start: () =>
        set({
          isGenerating: true,
          stage: "validating",
          percent: 0,
          stageLabel: "validating",
          error: null,
          errorKey: null,
          startedAt: Date.now(),
          steps: [],
          qualityIssues: [],
          qualityScore: null,
          modelUsed: null,
        }),
      updateStep: (step) =>
        set((s) => ({
          stage: step.stage,
          percent: step.percent,
          stageLabel: step.label,
          steps: [...s.steps, step],
        })),
      setError: (errorKey, msg) =>
        set({
          isGenerating: false,
          stage: "error",
          errorKey,
          error: msg ?? errorKey,
        }),
      cancel: () =>
        set({
          isGenerating: false,
          stage: "cancelled",
        }),
      complete: (info) =>
        set({
          isGenerating: false,
          stage: "complete",
          percent: 100,
          stageLabel: "complete",
          lastDurationMs: info.durationMs,
          modelUsed: info.modelUsed,
          qualityScore: info.qualityScore ?? null,
          qualityIssues: info.qualityIssues ?? [],
        }),
      reset: () =>
        set({
          isGenerating: false,
          stage: "idle",
          percent: 0,
          stageLabel: "",
          error: null,
          errorKey: null,
          startedAt: null,
          qualityIssues: [],
          qualityScore: null,
          steps: [],
        }),
    }),
    {
      name: "ai-studio-tryon",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        // Don't persist running state across reloads
        lastDurationMs: s.lastDurationMs,
        modelUsed: s.modelUsed,
        qualityScore: s.qualityScore,
        qualityIssues: s.qualityIssues,
      }),
    }
  )
);
