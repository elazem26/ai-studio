#!/usr/bin/env python3
"""End-to-end test: regional garment swap via Next.js API + video job quality."""
import json, urllib.request, sys, time

BASE = "http://localhost:3000"

def post(url, payload, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

# ---------- 1. REGIONAL garment swap ----------
print("=== 1. regional garment swap ===")
t0 = time.time()
r = post(f"{BASE}/api/images/garment-swap", {
    "sourcePath": "/uploads/test-group-3people.png",
    "garmentPath": "/uploads/0b1213f2-8907-4fe4-9a64-32a93462f749.jpg",
    "mappings": [{"sourceIndex": 2, "refIndex": 0}],
})
print(json.dumps(r, ensure_ascii=False)[:400])
print("elapsed: %.1fs" % (time.time() - t0))
if r.get("url"):
    print("method:", r.get("method"), "| applied:", r.get("applied"))
else:
    print("GARMENT-SWAP FAILED"); sys.exit(1)

# ---------- 2. video job (face mode, quality pass) ----------
print("\n=== 2. video face swap job ===")
t0 = time.time()
r2 = post(f"{BASE}/api/video/face-swap", {
    "videoPath": "/results/test-video.mp4",
    "refPath": "/uploads/0b1213f2-8907-4fe4-9a64-32a93462f749.jpg",
    "mappings": [{"videoIndex": 0, "refIndex": 0}],
    "mode": "face",
    "maxFrames": 30,
})
print(json.dumps(r2, ensure_ascii=False)[:200])
if not r2.get("taskId"):
    print("VIDEO JOB START FAILED"); sys.exit(1)
taskId = r2["taskId"]
deadline = time.time() + 900
while time.time() < deadline:
    time.sleep(3)
    st = json.loads(urllib.request.urlopen(f"{BASE}/api/task/status?id={taskId}", timeout=30).read())
    print("  progress: %s%% status=%s" % (st.get("progress"), st.get("status")))
    if st.get("status") == "done":
        res = st.get("result") or {}
        print("DONE in %.1fs -> %s | frames=%s/%s fps=%s" % (
            time.time() - t0, res.get("url"), res.get("processedFrames"),
            res.get("totalFrames"), res.get("fps")))
        break
    if st.get("status") == "error":
        print("ERROR:", st.get("error")); sys.exit(1)
print("\nALL-OK")
