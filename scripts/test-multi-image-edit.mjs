// Test: does zai.images.generations.edit accept MULTIPLE input images?
import sharp from "sharp";
import fs from "fs";

async function mkImg(color, label) {
  const svg = `<svg width="512" height="512"><rect width="512" height="512" fill="${color}"/><text x="256" y="270" font-size="80" fill="white" text-anchor="middle">${label}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const Z = (await import("z-ai-web-dev-sdk")).default;
  const zai = await Z.create();
  const a = await mkImg("#1a5fb4", "A");
  const b = await mkImg("#e01b24", "B");
  const t0 = Date.now();
  try {
    const r = await zai.images.generations.edit({
      prompt: "Merge: show both letter A and letter B side by side on one poster, keep both letters identical.",
      images: [{ url: a }, { url: b }],
      size: "1024x1024",
    });
    const b64 = r?.data?.[0]?.base64;
    if (!b64) { console.log("RESULT: no data"); return; }
    fs.writeFileSync("/tmp/compose-test-2img.png", Buffer.from(b64, "base64"));
    const meta = await sharp("/tmp/compose-test-2img.png").metadata();
    console.log(`MULTI-IMAGE OK in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${meta.width}x${meta.height}`);
  } catch (e) {
    console.log("MULTI-IMAGE FAILED:", String(e?.message || e).slice(0, 300));
  }
}
main();
