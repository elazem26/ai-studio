import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

/**
 * GET /api/system/status
 *
 * Returns the privacy/system snapshot for the "System & Privacy" page.
 * All values are computed at request time from local files/flags only.
 */
export async function GET() {
  // Check if any model is installed (look at /data/models dir)
  const modelsRoot = path.resolve(process.cwd(), "data/models");
  let modelsInstalledCount = 0;
  try {
    const entries = await fs.readdir(modelsRoot);
    modelsInstalledCount = entries.filter((e) => !e.startsWith(".")).length;
  } catch {
    // dir doesn't exist
  }

  // Check size of temp folder
  const tempRoot = path.resolve(process.cwd(), "data/temp");
  let tempSizeBytes = 0;
  try {
    const entries = await fs.readdir(tempRoot);
    for (const e of entries) {
      const st = await fs.stat(path.join(tempRoot, e));
      if (st.isFile()) tempSizeBytes += st.size;
    }
  } catch {
    // dir doesn't exist
  }

  return NextResponse.json({
    privacy: {
      internetRequired: true, // Cloud AI requires connection by default
      imageUpload: "cloud_ai_default", // images go to cloud AI service
      cloudProcessing: true,
      localAIEnabled: false, // user can switch to local CatVTON if they install it
      apiServer: "127.0.0.1",
      lanMode: false,
      currentMode: "cloud_ai", // cloud_ai | local_catvton | demo
    },
    storage: {
      modelsInstalled: modelsInstalledCount,
      tempSizeBytes,
      tempRoot,
    },
    build: {
      version: "0.2.0",
      timestamp: Date.now(),
    },
  });
}
