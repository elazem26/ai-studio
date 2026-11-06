#!/usr/bin/env python3
"""Direct E2E test of the new /garment/composite endpoint (mini-service 3030)."""
import base64, io, json, sys, urllib.request

import numpy as np
from PIL import Image, ImageDraw

BASE = "http://localhost:3030"


def post(path, payload, timeout=150):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def to_data_url(img: Image.Image, fmt="PNG", q=90):
    buf = io.BytesIO()
    img.save(buf, fmt, quality=q)
    return "data:image/" + ("png" if fmt == "PNG" else "jpeg") + ";base64," + base64.b64encode(buf.getvalue()).decode()


# 1) source: real 3-person test photo, downscaled for speed
src = Image.open("/home/z/my-project/scripts/studio-multi-ref.png").convert("RGB")
src.thumbnail((900, 1400))
src_url = to_data_url(src, "JPEG")

# 2) detect persons -> take first bbox (normalized)
det = post("/detect-persons", {"image": src_url})
persons = det.get("persons") or []
print("detected persons:", len(persons))
if not persons:
    sys.exit("no persons detected")
bbox = persons[0]["bbox"]
print("bbox[0]:", [round(v, 3) for v in bbox])

# 3) synthetic garment-on-white: red "top + skirt" set
g = Image.new("RGB", (640, 860), (255, 255, 255))
d = ImageDraw.Draw(g)
d.polygon([(140, 60), (500, 60), (560, 380), (80, 380)], fill=(178, 34, 52))   # top
d.rectangle([(170, 380), (470, 800)], fill=(178, 34, 52))                       # skirt
d.rectangle([(280, 60), (360, 140)], fill=(240, 240, 240))                      # neckline
gar_url = to_data_url(g)

# 4) composite
res = post("/garment/composite", {"source": src_url, "garment": gar_url, "bbox": bbox})
if not res.get("ok"):
    print("COMPOSITE FAILED:", res)
    sys.exit(1)
out_b64 = res["image"].split(",", 1)[1]
out = Image.open(io.BytesIO(base64.b64decode(out_b64))).convert("RGB")
out.save("/tmp/composite-test.png")
print("composite size:", out.size)

# 5) verify: region inside bbox changed a lot, outside ~unchanged
a = np.asarray(src, dtype=np.float32)
b = np.asarray(out.resize(src.size), dtype=np.float32)
H, W = a.shape[:2]
x1, y1, x2, y2 = [int(v * (W if i % 2 == 0 else H)) for i, v in enumerate(bbox)]
inside = np.abs(a[y1:y2, x1:x2] - b[y1:y2, x1:x2]).mean()
mask = np.ones((H, W), bool)
mask[max(0, y1 - 30):y2 + 30, max(0, x1 - 30):x2 + 30] = False
outside = np.abs(a[mask] - b[mask]).mean()
print(f"mean|diff| inside bbox: {inside:.1f} (expect >15), outside: {outside:.1f} (expect <6)")
print("PASS" if inside > 15 and outside < 6 else "CHECK MANUALLY")
