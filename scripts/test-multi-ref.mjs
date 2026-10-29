// Test multi-reference garment swap: 2 ref images (garmentPaths), each
// source person mapped to its own reference image + chained face swap.
const BASE = "http://localhost:3000";
const SOURCE = "/uploads/75450fca-f79e-4961-960f-3e66232e6be5.jpg"; // two ladies
const REF1 = "/uploads/4c3dbb17-9a85-4e00-93e0-c0b3806c08ca.jpg";   // striped set
const FACE_REF = "/uploads/4c3dbb17-9a85-4e00-93e0-c0b3806c08ca.jpg"; // has 1 clear face

async function pollJob(jobId) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${BASE}/api/images/garment-swap?jobId=${jobId}`);
    const job = await res.json();
    const secs = Math.round((Date.now() - t0) / 1000);
    if (job.status !== "done" && job.status !== "error") {
      console.log(`[${secs}s] ${job.stageLabelAr ?? ""} ${job.percent ?? ""}%`);
      continue;
    }
    return job;
  }
}

async function garmentMultiTest() {
  console.log("=== TEST 1: garment swap with TWO reference images ===");
  const post = await fetch(`${BASE}/api/images/garment-swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      async: true,
      sourcePath: SOURCE,
      // Same file as 2 different reference images — validates per-image
      // detection + per-(image,person) garment cache plumbing.
      garmentPaths: [REF1, REF1],
      mappings: [
        { sourceIndex: 0, refIndex: 0, refImage: 0 },
        { sourceIndex: 1, refIndex: 0, refImage: 1 },
      ],
    }),
  });
  const start = await post.json();
  console.log("POST:", post.status, JSON.stringify(start));
  if (!start.jobId) return;
  const job = await pollJob(start.jobId);
  console.log("GARMENT RESULT:", job.status, job.result?.url ?? job.message);
}

async function faceChainTest() {
  console.log("=== TEST 2: face swap chained across 2 reference images ===");
  // Call 1: source person 0 ← face from ref image
  const r1 = await fetch(`${BASE}/api/images/face-swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourcePath: SOURCE,
      facePath: FACE_REF,
      mappings: [{ sourceIndex: 0, faceIndex: 0 }],
    }),
  });
  const d1 = await r1.json();
  console.log("CALL1:", r1.status, d1.url ?? d1.message ?? d1.error);
  if (!d1.path && !d1.url) return;
  // Call 2: chain — source person 1 ← face from the SAME ref image,
  // editing the RESULT of call 1 (exactly what the UI does per group).
  const r2 = await fetch(`${BASE}/api/images/face-swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourcePath: d1.path ?? d1.url,
      facePath: FACE_REF,
      mappings: [{ sourceIndex: 1, faceIndex: 0 }],
    }),
  });
  const d2 = await r2.json();
  console.log("CALL2 (chained):", r2.status, d2.url ?? d2.message ?? d2.error);
}

(async () => {
  await garmentMultiTest();
  await faceChainTest();
})().catch((e) => { console.error("TEST ERROR:", e); process.exit(1); });
