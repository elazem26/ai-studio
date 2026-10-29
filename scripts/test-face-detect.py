#!/usr/bin/env python3
"""Test face detection + mapped swap on the face-swap-pro service."""
import base64, json, sys, urllib.request

BASE = "http://localhost:3030"
GROUP = "/home/z/my-project/data/uploads/test-group-3people.png"

def post(path, payload, timeout=180):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return e.code, {"error": body}

def as_data_url(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

# ---- 1) /detect on the group photo ----
status, data = post("/detect", {"image": as_data_url(GROUP)})
print("detect status:", status, flush=True)
faces = data.get("faces", [])
print("faces detected:", len(faces), flush=True)
for f in faces:
    print(f"  #{f['index']} bbox={f['bbox']} area={f['area']} score={f['score']}", flush=True)
if "error" in data:
    print("error:", data["error"][:400], flush=True)
print("DONE", flush=True)
