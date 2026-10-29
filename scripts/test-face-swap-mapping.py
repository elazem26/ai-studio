#!/usr/bin/env python3
"""Test mapped swap through the Next.js API (validates payload forwarding)."""
import json, urllib.request

NEXT = "http://localhost:3000"
GROUP = "/uploads/test-group-3people.png"

def post(path, payload, timeout=240):
    req = urllib.request.Request(
        NEXT + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as ex:
        return ex.code, json.loads(ex.read().decode()[:500] or "{}")

# ---- 1) detect via Next API ----
s, d = post("/api/images/face-detect", {"imagePath": GROUP})
print("next detect:", s, "count:", d.get("count"), flush=True)
for f in d.get("faces", []):
    print(f"  #{f['index']} bbox={f['bbox']}", flush=True)

# ---- 2) legacy swap (no indices) ----
s1, d1 = post("/api/images/face-swap", {"sourcePath": GROUP, "facePath": GROUP})
print("legacy swap:", s1, "method:", d1.get("method"), "url:", d1.get("url"), flush=True)
if s1 != 200: print("  err:", d1, flush=True)

# ---- 3) mapped swap: ref face #2 (smallest) -> source face #0 (largest) ----
s2, d2 = post("/api/images/face-swap", {
    "sourcePath": GROUP,
    "facePath": GROUP,
    "mappings": [{"sourceIndex": 0, "faceIndex": 2}],
})
print("mapped swap (ref#2 -> src#0):", s2, "url:", d2.get("url"), flush=True)
if s2 != 200: print("  err:", d2, flush=True)

# ---- 4) different mapping: ref #1 -> source #2 (must differ from #3) ----
s3, d3 = post("/api/images/face-swap", {
    "sourcePath": GROUP,
    "facePath": GROUP,
    "mappings": [{"sourceIndex": 2, "faceIndex": 1}],
})
print("mapped swap (ref#1 -> src#2):", s3, "url:", d3.get("url"), flush=True)
if s3 != 200: print("  err:", d3, flush=True)

# ---- 5) multi-merge in one call: ref#0 -> src#1 AND ref#1 -> src#2 ----
s4, d4 = post("/api/images/face-swap", {
    "sourcePath": GROUP,
    "facePath": GROUP,
    "mappings": [
        {"sourceIndex": 1, "faceIndex": 0},
        {"sourceIndex": 2, "faceIndex": 1},
    ],
})
print("multi-merge swap:", s4, "url:", d4.get("url"), flush=True)
if s4 != 200: print("  err:", d4, flush=True)

# ---- 6) out-of-range index must fail cleanly with 400 ----
s5, d5 = post("/api/images/face-swap", {
    "sourcePath": GROUP,
    "facePath": GROUP,
    "sourceIndex": 99,
})
print("out-of-range:", s5, "error:", str(d5.get("error", d5))[:120], flush=True)

ok = s1 == 200 and s2 == 200 and s3 == 200 and s4 == 200 and s5 == 400
if ok and d1.get("url") and d2.get("url"):
    import urllib.request as u
    a = u.urlopen(NEXT + d1["url"], timeout=30).read()
    b = u.urlopen(NEXT + d2["url"], timeout=30).read()
    print("legacy vs mapped differ:", a != b, f"({len(a)}B vs {len(b)}B)", flush=True)
print("ALL-OK" if ok else "SOME-FAILED", flush=True)
