// Test: full-outfit (top + bottom) garment swap via async job API
const BASE = "http://localhost:3000";
const SOURCE = "/uploads/75450fca-f79e-4961-960f-3e66232e6be5.jpg"; // two ladies (purple + red gowns)
const REF = "/uploads/4c3dbb17-9a85-4e00-93e0-c0b3806c08ca.jpg";    // blue/white striped two-piece set
const SOURCE_INDEX = Number(process.argv[2] ?? 0);
const BOTH = process.argv[3] === "both";
const MAPPINGS = BOTH
  ? [{ sourceIndex: 0, refIndex: 0 }, { sourceIndex: 1, refIndex: 0 }]
  : [{ sourceIndex: SOURCE_INDEX, refIndex: 0 }];

async function main() {
  const post = await fetch(`${BASE}/api/images/garment-swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      async: true,
      sourcePath: SOURCE,
      garmentPath: REF,
      mappings: MAPPINGS,
    }),
  });
  const start = await post.json();
  console.log("POST:", post.status, JSON.stringify(start));
  if (!start.jobId) process.exit(1);

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${BASE}/api/images/garment-swap?jobId=${start.jobId}`);
    const job = await res.json();
    const secs = Math.round((Date.now() - t0) / 1000);
    if (job.status !== "done" && job.status !== "error") {
      console.log(`[${secs}s] ${job.stageAr ?? job.stage ?? ""} ${job.percent ?? ""}%`);
      continue;
    }
    console.log(`[${secs}s] FINAL:`, JSON.stringify(job, null, 2));
    break;
  }
}

main().catch((e) => { console.error("TEST ERROR:", e); process.exit(1); });
