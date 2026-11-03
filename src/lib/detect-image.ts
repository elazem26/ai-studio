import sharp from "sharp";

/**
 * Read an image from disk and return a downscaled JPEG data URL OPTIMIZED
 * FOR DETECTION (faces / persons).
 *
 * Why: users upload huge photos (10-25MB, 4000-8000px). Sending the full
 * base64 to the python detector makes each detection call take seconds
 * just to decode/transfer. The detector works on normalized 0..1
 * coordinates, so downscaling NEVER changes the returned box coordinates.
 *
 * maxDim=1280 keeps even small faces fully detectable while cutting the
 * payload by ~10-50x.
 */
export async function readForDetect(absPath: string, maxDim = 1280): Promise<string> {
  const fs = await import("fs/promises");
  const buf = await fs.readFile(absPath);
  try {
    const img = sharp(buf, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const scale = Math.min(1, maxDim / Math.max(1, w, h));
    // The python detector letterboxes its input to 640px internally, so a
    // >1280px source adds cost with ZERO detection benefit.
    if (scale < 1) {
      const out = await img
        .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
        .jpeg({ quality: 90 })
        .toBuffer();
      return `data:image/jpeg;base64,${out.toString("base64")}`;
    }
    // No resize needed: pass JPEG/PNG bytes through WITHOUT re-encoding
    if (meta.format === "jpeg" || meta.format === "png") {
      const mime = meta.format === "jpeg" ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const out = await img.jpeg({ quality: 92 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    // Unreadable by sharp → pass the original bytes through unchanged
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
}
