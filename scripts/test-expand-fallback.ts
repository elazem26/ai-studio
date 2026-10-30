/**
 * Test the expand route's DETERMINISTIC FALLBACK in isolation:
 * replicates the exact fallback path from
 * src/app/api/images/expand/route.ts (sharp mirror, sharpMode).
 *
 * Usage: bun scripts/test-expand-fallback.ts <inputImage> <outPreview>
 */
import sharp from "sharp";
import { buildPaddedBase } from "../src/app/api/images/expand/route";
import { promises as fs } from "fs";

async function main() {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) {
    console.error("usage: bun scripts/test-expand-fallback.ts <in> <out>");
    process.exit(1);
  }
  const origBuf = await fs.readFile(input);
  const meta = await sharp(origBuf).metadata();
  const srcW = meta.width ?? 768;
  const srcH = meta.height ?? 1024;

  // direction "all", percentage 20 — the UI default
  const percentage = 20;
  const extTop = Math.round(srcH * (percentage / 100));
  const extBottom = extTop;
  const extLeft = Math.round(srcW * (percentage / 100));
  const extRight = extLeft;
  const targetW = srcW + extLeft + extRight;
  const targetH = srcH + extTop + extBottom;

  const started = Date.now();
  const fallbackBase = await buildPaddedBase(
    origBuf, srcW, srcH, targetW, targetH, extLeft, extTop,
    { top: extTop, bottom: extBottom, left: extLeft, right: extRight },
    // MUST mirror the route's fallback opts exactly (featherStrips false!)
    { stripBlur: 0, featherStrips: false, cornerMirror: true, sharpMode: true }
  );

  const resultMeta = await sharp(fallbackBase).metadata();
  await fs.writeFile(out, fallbackBase);
  console.log(
    `OK ${srcW}x${srcH} -> ${resultMeta.width}x${resultMeta.height} in ${Date.now() - started}ms -> ${out}`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
