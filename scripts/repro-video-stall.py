#!/usr/bin/env python3
"""Reproduce the user's video face-swap flow exactly and watch where it stalls."""
import json, time, urllib.request, sys

BASE = "http://localhost:3000"
VIDEO = "/results/vswap-1793189996259-9bwg2u-reface-2024-03-23-08-37-21.mp4"
REF = "/uploads/0b1213f2-8907-4fe4-9a64-32a93462f749.jpg"

def post_json(url, payload, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())

def get_json(url, timeout=15):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())

print("== 1. POST /api/video/face-swap (start) ==")
t0 = time.time()
try:
    st, d = post_json(f"{BASE}/api/video/face-swap", {
        "videoPath": VIDEO, "refPath": REF,
        "mappings": [{"videoIndex": 0, "refIndex": 0}],
        "mode": "face", "maxFrames": 400,
    })
except urllib.error.HTTPError as e:
    st = e.code
    d = json.loads(e.read().decode())
print(f"   status={st} elapsed={time.time()-t0:.1f}s resp={json.dumps(d, ensure_ascii=False)[:400]}")
if st != 200 or not d.get("taskId"):
    print("!! START FAILED — this is where the user's flow dies")
    sys.exit(1)

task = d["taskId"]
print(f"== 2. polling /api/task/status?id={task} ==")
last = None
stall_count = 0
for i in range(180):  # up to 6 min
    time.sleep(2)
    try:
        st, td = get_json(f"{BASE}/api/task/status?id={task}")
    except urllib.error.HTTPError as e:
        print(f"   poll error HTTP {e.code}")
        continue
    key = (td.get("status"), td.get("progress"), td.get("phase"))
    if key != last:
        print(f"   [{i*2:3d}s] status={td.get('status')} progress={td.get('progress')}% phase={td.get('phase')} err={td.get('error')}")
        last = key
        stall_count = 0
    else:
        stall_count += 1
        if stall_count == 30:  # 60s no change
            print(f"   !! STALLED at {key} for 60s — checking python service directly")
    if td.get("status") in ("done", "error"):
        print(f"   FINAL: {json.dumps(td, ensure_ascii=False)[:600]}")
        break
else:
    print("   !! 6 MINUTES ELAPSED without completion")
