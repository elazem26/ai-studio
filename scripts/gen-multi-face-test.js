// Generate a multi-person test image for face-box detection testing.
const ZAI = require("z-ai-web-dev-sdk").default;
const fs = require("fs");

async function main() {
  const zai = await ZAI.create();
  const res = await zai.images.generations.create({
    prompt:
      "Realistic group photograph of three people standing side by side outdoors in soft daylight: a man in a blue shirt, a woman in a red dress, and a young man in a green jacket. All three faces clearly visible, facing the camera, sharp focus, natural lighting, photorealistic.",
    size: "1344x768",
  });
  const b64 = res.data[0].base64;
  const out = "/home/z/my-project/data/uploads/test-group-3people.png";
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("SAVED", out, fs.statSync(out).size, "bytes");
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
