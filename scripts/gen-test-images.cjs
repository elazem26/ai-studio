/**
 * Generate two test images for the garment-swap pipeline test:
 *  1. source: a man in casual sportswear, full body
 *  2. reference: a man in a formal navy suit, full body
 */
const ZAI = require("z-ai-web-dev-sdk").default ?? require("z-ai-web-dev-sdk");
const fs = require("fs");
const path = require("path");

async function main() {
  const zai = await ZAI.create();
  const outDir = "/home/z/my-project/data/uploads";
  fs.mkdirSync(outDir, { recursive: true });

  const jobs = [
    {
      prompt:
        "Full body photo of a man standing in a living room, wearing a gray hoodie and black sweatpants, natural lighting, realistic photography, sharp focus, single person only",
      out: "test-source.jpg",
    },
    {
      prompt:
        "Full body photo of a man standing in an office, wearing an elegant navy blue formal suit with white shirt and tie, natural lighting, realistic photography, sharp focus, single person only",
      out: "test-ref.jpg",
    },
  ];

  for (const job of jobs) {
    const res = await zai.images.generations.create({
      prompt: job.prompt,
      size: "864x1152",
    });
    const b64 = res?.data?.[0]?.base64;
    if (!b64) throw new Error("no image for " + job.out);
    const outPath = path.join(outDir, job.out);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log("saved:", outPath, fs.statSync(outPath).size, "bytes");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
