#!/usr/bin/env python3
"""E2E test of the ONE-WHOLE-IMAGE merge: hit /transplant on :3030 with
cross-lighting images and save results for visual inspection."""
import base64, json, time, urllib.request, sys

BASE = "http://localhost:3030"
OUT = "/home/z/my-project/data/test-transplant"

def b64(p):
    with open(p, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

def call(payload, tag):
    t0 = time.time()
    req = urllib.request.Request(
        BASE + "/transplant",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        d = json.loads(e.read().decode())
    dt = time.time() - t0
    ok = d.get("ok")
    print(f"[{tag}] ok={ok} t={dt:.1f}s" + ("" if ok else f" err={d.get('error')}"))
    if ok:
        img = d["result"].split(",", 1)[1]
        with open(f"{OUT}/result_{tag}.png", "wb") as f:
            f.write(base64.b64decode(img))
    return ok

src1 = b64(f"{OUT}/src_indoor.png")
ref_studio = b64(f"{OUT}/ref_studio.png")
ref_out = b64(f"{OUT}/ref_outdoor.png")
src_night = b64(f"{OUT}/src_night.png")
# real-face images: man (studio) ↔ woman (outdoor golden hour)
real_a = b64(f"{OUT}/portrait_wom_0.img")   # source: woman outdoor
real_b = b64(f"{OUT}/portrait_man_1.img")   # ref: man studio

fails = 0
# 1) head: studio man's head onto outdoor woman (big lighting mismatch)
fails += not call({"source": real_a, "ref": real_b, "mode": "head",
                   "colorStrength": 0.7}, "head_man2woman")
# 2) whole person: outdoor person into night scene
fails += not call({"source": src_night, "ref": ref_out, "mode": "person",
                   "region": "full", "colorStrength": 0.7}, "person_out2night")
# 3) object: outdoor person as 'object' into indoor scene
fails += not call({"source": src1, "ref": ref_out, "mode": "object",
                   "colorStrength": 0.7}, "object_out2indoor")
# 4) chest region transplant between real photos
fails += not call({"source": real_a, "ref": real_b, "mode": "person",
                   "region": "chest", "colorStrength": 0.7}, "chest_man2woman")
print("FAILS:", fails)
sys.exit(1 if fails else 0)
