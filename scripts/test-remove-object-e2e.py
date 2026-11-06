#!/usr/bin/env python3
"""E2E: POST /api/images/remove-object with mask via the Next.js server."""
import base64, json, urllib.request
import numpy as np
import cv2

BASE = "http://localhost:3000"
IMG_REL = "data/uploads/e2e-obj.png"

# --- build a "photo": smooth gradient + grain, with a dark watch-like object ---
rng = np.random.default_rng(3)
h, w = 720, 900
img = np.zeros((h, w, 3), np.uint8)
for y in range(h):
    t = y / h
    img[y, :, 0] = int(110 + 70 * t)
    img[y, :, 1] = int(140 + 50 * t)
    img[y, :, 2] = int(170 + 40 * t)
img = np.clip(img.astype(np.float32) + rng.normal(0, 3, (h, w, 1)).repeat(3, 2), 0, 255).astype(np.uint8)
# object: dark rounded "watch" with bright face
cv2.circle(img, (450, 360), 60, (25, 25, 30), -1)
cv2.circle(img, (450, 360), 38, (220, 225, 230), -1)
cv2.line(img, (450, 332), (450, 388), (60, 60, 70), 5)
cv2.line(img, (422, 360), (478, 360), (60, 60, 70), 5)

ok, buf = cv2.imencode(".png", img)
with open("/home/z/my-project/data/uploads/e2e-obj.png", "wb") as f:
    f.write(buf.tobytes())

mask = np.zeros((h, w), np.uint8)
cv2.circle(mask, (450, 360), 66, 255, -1)
ok, mbuf = cv2.imencode(".png", cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR))
mask_data_url = "data:image/png;base64," + base64.b64encode(mbuf.tobytes()).decode()

payload = {"sourcePath": IMG_REL, "maskDataUrl": mask_data_url, "growPx": 6, "featherPx": 4}
req = urllib.request.Request(
    BASE + "/api/images/remove-object",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    res = json.loads(urllib.request.urlopen(req, timeout=300).read())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read()[:500]); raise SystemExit(1)

print("method:", res.get("method"), "| size:", res.get("width"), "x", res.get("height"), "| bytes:", res.get("size"))
out = cv2.imread(res["path"])
if out is None:
    raise SystemExit("result file missing: " + res["path"])

# outside (mask + grow + feather ring) must be bit-identical to the source
check = cv2.dilate(mask, np.ones((25, 25), np.uint8))
diff = np.abs(out.astype(int) - img.astype(int)).sum(axis=2)
viol = int(((diff > 0) & (check == 0)).sum())
inside_changed = float((diff[mask > 0] > 8).mean())
center = out[330:390, 420:480].mean()
print(f"CHECK1 outside-mask changed px: {viol} (must be 0)")
print(f"CHECK2 inside-mask changed fraction: {inside_changed:.1%}")
print(f"CHECK3 center brightness after removal: {center:.1f} (bg ~130-200, object was dark)")
cv2.imwrite("/tmp/e2e_compare.png", np.hstack([img, np.full((h, 6, 3), 255, np.uint8), out])[::2, ::2])
print("result url:", res.get("url"))
