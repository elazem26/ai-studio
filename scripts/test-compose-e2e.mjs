// E2E test: compose-agent + voice TTS/ASR through the real Next.js server
import fs from "fs";

const BASE = "http://localhost:3000";

async function genPortrait(prompt, out) {
  const Z = (await import("z-ai-web-dev-sdk")).default;
  const zai = await Z.create();
  const r = await zai.images.generations.create({ prompt, size: "768x1344" });
  const b64 = r?.data?.[0]?.base64;
  if (!b64) throw new Error("gen failed: " + prompt);
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("generated:", out, fs.statSync(out).size, "bytes");
}

async function upload(fp) {
  const buf = fs.readFileSync(fp);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "image/png" }), fp.split("/").pop());
  const r = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: fd });
  const d = await r.json();
  if (!r.ok) throw new Error("upload failed: " + JSON.stringify(d));
  console.log("uploaded:", fp, "→", d.path, `${d.width}x${d.height}`);
  return d;
}

async function compose(body) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/images/compose-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("compose start failed: " + JSON.stringify(d));
  console.log("task:", d.taskId);
  for (let i = 0; i < 100; i++) {
    await new Promise((s) => setTimeout(s, 3000));
    const sr = await fetch(`${BASE}/api/task/status?id=${d.taskId}`);
    const sd = await sr.json();
    process.stdout.write(`  [${i}] ${sd.status} ${sd.phase ?? ""} ${sd.progress ?? 0}%\n`);
    if (sd.status === "done") {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`DONE in ${secs}s →`, JSON.stringify({ url: sd.result.url, method: sd.result.method, size: sd.result.size, w: sd.result.width, h: sd.result.height }));
      return sd.result;
    }
    if (sd.status === "error") throw new Error("task error: " + sd.error);
  }
  throw new Error("timeout");
}

async function main() {
  // ---- 1) TTS: Arabic text → wav
  const tr = await fetch(`${BASE}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "مرحبًا، تم بناء الصورة بنجاح. يمكنك الآن حفظها أو طباعتها." }),
  });
  if (!tr.ok) {
    console.log("TTS FAILED:", tr.status, (await tr.text()).slice(0, 200));
  } else {
    const wb = Buffer.from(await tr.arrayBuffer());
    fs.writeFileSync("/tmp/tts-test.wav", wb);
    console.log("TTS OK:", wb.length, "bytes, type:", tr.headers.get("content-type"));
  }

  // ---- 2) ASR: TTS output → text (roundtrip)
  if (fs.existsSync("/tmp/tts-test.wav")) {
    const ab = fs.readFileSync("/tmp/tts-test.wav").toString("base64");
    const ar = await fetch(`${BASE}/api/voice/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: ab }),
    });
    const ad = await ar.json();
    console.log("ASR:", ar.ok ? `OK → "${ad.text}"` : `FAILED ${ar.status} ${JSON.stringify(ad).slice(0, 200)}`);
  }

  // ---- 3) compose-agent full flow
  console.log("generating portraits…");
  await genPortrait("Ultra realistic professional studio portrait photograph of a handsome Middle Eastern man in his 30s, short dark hair, trimmed beard, white shirt, neutral gray background, soft studio lighting, head and shoulders", "/tmp/person-a.png");
  await genPortrait("Ultra realistic professional studio portrait photograph of a beautiful Middle Eastern woman in her 20s, brown shoulder-length hair, elegant blouse, neutral gray background, soft studio lighting, head and shoulders", "/tmp/person-b.png");

  const a = await upload("/tmp/person-a.png");
  const b = await upload("/tmp/person-b.png");

  const res = await compose({
    sourcePath: a.path,
    referencePath: b.path,
    instruction: "اجمع الرجل والمرأة في صورة واحدة لحفل زفافهما: الرجل يرتدي بدلة زفاف سوداء أنيقة والمرأة ترتدي فستان زفاف أبيض وبشعر أسود طويل ناعم، خلفية قاعة زفاف فخمة بإضاءة دافئة",
  });
  if (res?.url) {
    const img = await fetch(`${BASE}${res.url}`);
    fs.writeFileSync("/tmp/compose-result.png", Buffer.from(await img.arrayBuffer()));
    console.log("result saved: /tmp/compose-result.png");
  }
}
main().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
