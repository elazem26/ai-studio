/* Probe z-ai SDK video generation API shape (request + response + polling). */
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const zai = await ZAI.create();

const body = {
  prompt: "A red apple on a wooden table, camera slowly orbiting, cinematic lighting, 4k",
  // some APIs need size/aspect or duration — try minimal first
};

try {
  const res = await zai.video.generations.create(body);
  console.log("CREATE RESPONSE:", JSON.stringify(res).slice(0, 600));
  const taskId = res?.taskId || res?.id || res?.data?.taskId || res?.data?.id;
  console.log("TASK ID:", taskId);
  if (taskId) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const q = await zai.async.result.query(taskId);
      const s = JSON.stringify(q);
      console.log(`POLL ${i}:`, s.slice(0, 400));
      const st = (q?.status || q?.data?.status || "").toLowerCase();
      if (["succeeded", "success", "completed", "done", "failed", "error"].includes(st)) break;
    }
  }
} catch (e) {
  console.log("ERROR:", e?.message?.slice(0, 500));
  if (e?.response) console.log("RESPONSE:", String(e.response).slice(0, 300));
}
