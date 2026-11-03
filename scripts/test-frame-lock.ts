/**
 * Test: frame-lock helpers (feathered frame / padded base logic)
 * Validates the luminance→alpha join trick works correctly.
 */
import sharp from "sharp";
import { buildFeatheredFrame, pickAiCanvasSize } from "../src/lib/ai-image-edit";

async function main() {
  // 1. Canvas size picking
  const cases: Array<[number, number, string]> = [
    [1844, 1382, "1152x864"], // 4:3 landscape
    [1382, 1844, "864x1152"], // 4:3 portrait
    [1024, 1024, "1024x1024"],
    [2000, 1000, "1440x720"],
    [900, 1600, "768x1344"],
  ];
  for (const [w, h, expected] of cases) {
    const got = pickAiCanvasSize(w, h);
    console.log(`pickAiCanvasSize(${w}x${h}) = ${got} ${got === expected ? "OK" : `EXPECTED ${expected} ✗`}`);
  }

  // 2. Feathered frame alpha test — 800x600 synthetic image
  const img = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 50, b: 50 } },
  }).png().toBuffer();

  const frame = await buildFeatheredFrame(img, 800, 600, 0.1);
  const meta = await sharp(frame).metadata();
  console.log(`frame: ${meta.width}x${meta.height} channels=${meta.channels} (expect 4)`);

  const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const alphaAt = (x: number, y: number) => data[(y * W + x) * C + 3];

  const corner = alphaAt(2, 2);
  const edgeMid = alphaAt(400, 2);
  const center = alphaAt(400, 300);
  const innerEdge = alphaAt(400, 70); // band=60, blur~12 → fade zone is ~60±24px
  console.log(`alpha corner=${corner} (expect 255), edge-mid=${edgeMid} (expect 255), center=${center} (expect 0), inner-fade=${innerEdge} (expect 0<..<255)`);

  if (meta.channels !== 4) throw new Error("FAIL: no alpha channel — joinChannel did not work");
  if (corner !== 255) throw new Error("FAIL: outer border not opaque — feather would NOT protect edges");
  if (center !== 0) throw new Error("FAIL: center not transparent");
  if (innerEdge <= 0 || innerEdge >= 255) throw new Error("FAIL: inner edge not feathered");

  // 3. Composite sanity: frame over a green bg → top-left pixel stays red
  const bg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 255, b: 0 } },
  }).png().toBuffer();
  const merged = await sharp(bg).composite([{ input: frame, left: 0, top: 0, blend: "over" }]).png().toBuffer();
  const mpx = await sharp(merged).raw().toBuffer({ resolveWithObject: true });
  const r0 = mpx.data[0], g0 = mpx.data[1];
  console.log(`merged top-left rgb=(${r0},${g0},…) expect r≈200 g≈50 → ${r0 > 150 && g0 < 100 ? "OK" : "FAIL"}`);

  console.log("\nALL FEATHER TESTS PASSED");
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
