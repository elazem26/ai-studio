import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * Detect local hardware capabilities.
 *
 * We try (in order):
 *   1. nvidia-smi (if available) for GPU/VRAM
 *   2. lscpu / wmic for CPU
 *   3. Node's os module for RAM
 *
 * All wrapped in try/catch — this must never crash the API.
 */
export async function GET() {
  let gpu: string | null = null;
  let vramTotalMB: number | null = null;
  let vramUsedMB: number | null = null;
  let vramFreeMB: number | null = null;
  let cudaAvailable = false;

  try {
    const out = execSync("nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits", {
      timeout: 2000,
      encoding: "utf8",
    }).trim();
    if (out) {
      const [name, total, used, free] = out.split(/\n|,\s*/).map((s) => s.trim());
      gpu = name || null;
      vramTotalMB = total ? Number(total) : null;
      vramUsedMB = used ? Number(used) : null;
      vramFreeMB = free ? Number(free) : null;
      cudaAvailable = true;
    }
  } catch {
    // No NVIDIA GPU / nvidia-smi not installed
  }

  let cpu: string | null = null;
  try {
    if (process.platform === "win32") {
      cpu = execSync("wmic cpu get name", { encoding: "utf8" })
        .split("\n")
        .filter((l) => l.trim() && !l.toLowerCase().includes("name"))
        .join("")
        .trim();
    } else {
      cpu = execSync("lscpu | grep -E 'Model name' | head -1", {
        encoding: "utf8",
        timeout: 1500,
      })
        .replace(/Model name:\s*/i, "")
        .trim();
    }
  } catch {
    cpu = null;
  }

  const ramTotalGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);

  // Hardware preference
  let preference: HardwarePreference = "cpu";
  if (cudaAvailable && vramFreeMB != null) {
    if (vramFreeMB >= 16384) preference = "cuda_high";
    else if (vramFreeMB >= 8192) preference = "cuda_mid";
    else if (vramFreeMB >= 4096) preference = "cuda_low";
  }

  const snapshot: {
    gpu: string | null;
    vramTotalMB: number | null;
    vramUsedMB: number | null;
    vramFreeMB: number | null;
    cudaAvailable: boolean;
    cpu: string | null;
    ramTotalGB: number;
    preference: HardwarePreference;
  } = {
    gpu,
    vramTotalMB,
    vramUsedMB,
    vramFreeMB,
    cudaAvailable,
    cpu,
    ramTotalGB,
    preference,
  };

  // Don't log every poll — log only on request
  void logEvent;
  return NextResponse.json(snapshot);
}

type HardwarePreference = "cuda_high" | "cuda_mid" | "cuda_low" | "cpu";
