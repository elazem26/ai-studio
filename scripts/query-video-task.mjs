/* Query an EXISTING z-ai video task to capture the final payload shape. */
const ZAI = (await import("z-ai-web-dev-sdk")).default;
const zai = await ZAI.create();
const taskId = process.argv[2];
for (let i = 0; i < 55; i++) {
  try {
    const q = await zai.async.result.query(taskId);
    const s = JSON.stringify(q);
    console.log(`POLL ${i}:`, s.slice(0, 700));
    const st = String(q?.task_status || q?.status || "").toUpperCase();
    if (st === "SUCCESS" || st === "FAILED" || st === "DONE" || st === "COMPLETED") break;
  } catch (e) {
    console.log(`POLL ${i} ERR:`, e?.message?.slice(0, 200));
  }
  await new Promise((r) => setTimeout(r, 6000));
}
