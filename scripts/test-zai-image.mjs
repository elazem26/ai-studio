/* Probe z-ai images.generations.create (text→image) shape. */
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const zai = await ZAI.create();
try {
  const res = await zai.images.generations.create({
    prompt: "A traditional Arabic coffee cup on a rustic wooden table, desert sunset through window, golden hour, cinematic, photorealistic",
    size: "1344x768",
  });
  const b64 = res?.data?.[0]?.base64;
  console.log("keys:", Object.keys(res || {}));
  console.log("b64 length:", b64 ? b64.length : "NONE");
  if (b64) {
    const fs = await import("fs");
    fs.writeFileSync("/tmp/zai-image-test.png", Buffer.from(b64, "base64"));
    console.log("saved /tmp/zai-image-test.png");
  }
} catch (e) {
  console.log("ERROR:", e?.message?.slice(0, 300));
}
