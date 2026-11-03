#!/usr/bin/env python3
"""End-to-end tests: persons detection + video face/garment jobs + garment image swap."""
import json, sys, time, urllib.request, pathlib

NEXT = "http://localhost:3000"
GROUP_ABS = "/home/z/my-project/data/uploads/test-group-3people.png"
GROUP_URL = "/uploads/test-group-3people.png"

def http(url, payload=None, timeout=120, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    hdrs = headers or ({"Content-Type": "application/json"} if payload is not None else {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            try: return r.status, json.loads(body)
            except: return r.status, {"raw": body[:200]}
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except: return e.code, {}

def wait_task(task_id, max_s=600):
    t0 = time.time()
    while time.time() - t0 < max_s:
        s, d = http(f"{NEXT}/api/task/status?id={task_id}")
        if s == 200:
            if d.get("status") == "done": return d.get("result", {})
            if d.get("status") == "error": raise RuntimeError("task error: " + str(d.get("error"))[:200])
        time.sleep(1.2)
    raise RuntimeError("task timeout")

print("=== 1) detect-persons (image) ===", flush=True)
s, d = http(f"{NEXT}/api/images/face-detect", {"imagePath": GROUP_URL, "mode": "persons"})
print("status:", s, "count:", d.get("count"), flush=True)
for p in d.get("persons", []):
    print(f"  person#{p['index']} torso={p['bbox']}", flush=True)
assert s == 200 and d.get("count", 0) >= 2, "persons detection failed"

print("=== 2) make test video (3s from group image) ===", flush=True)
import subprocess
vid_path = "/home/z/my-project/data/results/test-video.mp4"
subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", GROUP_ABS, "-t", "3", "-r", "24",
                "-vf", "scale=864:-2", "-pix_fmt", "yuv420p", vid_path],
               capture_output=True, timeout=60)
print("video:", pathlib.Path(vid_path).stat().st_size, "bytes", flush=True)

print("=== 3) video upload + frame detect ===", flush=True)
raw = pathlib.Path(vid_path).read_bytes()
s, d = http(f"{NEXT}/api/video/face-swap?mode=upload&filename=test.mp4&size={len(raw)}", raw=raw,
            headers={"Content-Type": "application/octet-stream"}, timeout=120)
print("upload status:", s, "taskId:", d.get("taskId"), flush=True)
assert s == 200 and d.get("taskId"), f"upload failed: {d}"
res = wait_task(d["taskId"], 120)
print("poster:", res.get("posterUrl"), "faces:", len(res.get("faces", [])), "persons:", len(res.get("persons", [])), flush=True)
video_path = res.get("videoPath")
assert video_path and res.get("faces"), "upload+detect failed"

print("=== 4) video FACE swap job (video#0 <- ref#1, 30 frames) ===", flush=True)
s, d = http(f"{NEXT}/api/video/face-swap", {
    "videoPath": video_path, "refPath": GROUP_URL,
    "mappings": [{"videoIndex": 0, "refIndex": 1}],
    "mode": "face", "maxFrames": 30,
})
print("start:", s, "taskId:", d.get("taskId"), flush=True)
assert s == 200 and d.get("taskId"), f"start failed: {d}"
res = wait_task(d["taskId"], 600)
print("FACE result:", res.get("url"), "frames:", res.get("processedFrames"), flush=True)
assert res.get("url"), "face video swap failed"

print("=== 5) video GARMENT swap job (video#0 <- ref#2) ===", flush=True)
s, d = http(f"{NEXT}/api/video/face-swap", {
    "videoPath": video_path, "refPath": GROUP_URL,
    "mappings": [{"videoIndex": 0, "refIndex": 2}],
    "mode": "garment", "maxFrames": 30,
})
print("start:", s, "taskId:", d.get("taskId"), flush=True)
assert s == 200 and d.get("taskId"), f"start failed: {d}"
res = wait_task(d["taskId"], 600)
print("GARMENT result:", res.get("url"), "frames:", res.get("processedFrames"), flush=True)
assert res.get("url"), "garment video swap failed"

print("=== 6) image GARMENT swap (src#0 <- ref#2) ===", flush=True)
s, d = http(f"{NEXT}/api/images/garment-swap", {
    "sourcePath": GROUP_URL, "garmentPath": GROUP_URL,
    "mappings": [{"sourceIndex": 0, "refIndex": 2}],
}, timeout=300)
print("garment image swap:", s, d.get("url"), d.get("method"), flush=True)
if s != 200: print("  err:", str(d)[:300], flush=True)

print("ALL-VIDEO-TESTS-DONE", flush=True)
