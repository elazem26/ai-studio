// Test: multi-result garment swap (numResults=2) via the async job API
const BASE = "http://localhost:3000";
const paths = JSON.parse((await import("fs")).readFileSync("/tmp/swap-test-paths.json", "utf8"));

const post = await fetch(`${BASE}/api/images/garment-swap`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sourcePath: paths.source,
    garmentPaths: [paths.garment],
    mappings: [{ sourceIndex: 0, refIndex: 0, refImage: 0 }],
    numResults: 2,
    async: true,
  }),
});
const start = await post.json();
console.log("POST:", post.status, JSON.stringify(start));
if (!start?.jobId) process.exit(1);

const t0 = Date.now();
let job = null;
while (Date.now() - t0 < 11 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 4000));
  const r = await fetch(`${BASE}/api/images/garment-swap?jobId=${encodeURIComponent(start.jobId)}`);
  job = await r.json();
  if (job.status === "done" || job.status === "error") break;
  process.stdout.write(`  [${Math.round((Date.now() - t0) / 1000)}s] ${job.status} ${job.percent}% ${job.stageLabelAr || ""}\r`);
}
console.log();
if (job?.status !== "done") {
  console.log("FINAL:", JSON.stringify(job).slice(0, 400));
  process.exit(1);
}
const results = job.results || [];
console.log(`DONE in ${Math.round((Date.now() - t0) / 1000)}s — results: ${results.length}, result(compat): ${job.result?.url}`);
for (const r of results) console.log(`  - ${r.url} (${r.width}x${r.height}, ${r.method})`);
console.log(results.length === 2 ? "MULTI-RESULT OK ✅" : `EXPECTED 2 RESULTS — GOT ${results.length} ❌`);
