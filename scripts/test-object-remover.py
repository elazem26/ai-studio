#!/usr/bin/env python3
"""Test object-remover /inpaint: object removed + outside-mask pixels identical."""
import base64, json, urllib.request
import numpy as np
import cv2

def b64(img):
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()

# --- synthetic photo: skin-like gradient background with soft noise ---
rng = np.random.default_rng(7)
h, w = 640, 800
base = np.zeros((h, w, 3), np.uint8)
for y in range(h):
    t = y / h
    base[y, :, 0] = int(120 + 60 * t)  # B
    base[y, :, 1] = int(150 + 40 * t)  # G
    base[y, :, 2] = int(180 + 30 * t)  # R
noise = rng.normal(0, 4, (h, w, 1)).repeat(3, axis=2)
base = np.clip(base.astype(np.float32) + noise, 0, 255).astype(np.uint8)
# a "tattoo": dark star-ish blob at (400, 300)
obj = base.copy()
cv2.circle(obj, (400, 300), 42, (30, 20, 25), -1)
cv2.circle(obj, (400, 300), 24, (200, 180, 190), -1)
test = obj.copy()

# mask covering the tattoo
mask = np.zeros((h, w), np.uint8)
cv2.circle(mask, (400, 300), 48, 255, -1)

payload = {
    "image_b64": b64(test),
    "mask_b64": b64(cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)),
    "growPx": 4,
    "featherPx": 3,
}
req = urllib.request.Request(
    "http://localhost:3031/inpaint",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
res = json.loads(urllib.request.urlopen(req, timeout=180).read())
print("method:", res["method"], "elapsed:", res["elapsedMs"], "ms")
out = cv2.imdecode(np.frombuffer(base64.b64decode(res["image_b64"]), np.uint8), cv2.IMREAD_COLOR)

# CHECK 1: outside (mask + grow + feather + safety) pixels must be bit-identical.
# growPx=4 dilation ±4px, feather blur spreads ~±3px → allow 10px ring.
check = cv2.dilate(mask, np.ones((21, 21), np.uint8))
diff_out = np.abs(out.astype(int) - test.astype(int)).sum(axis=2)
viol = int(((diff_out > 0) & (check == 0)).sum())
print("CHECK1 outside-mask changed pixels:", viol, "(must be 0)")

# CHECK 2: inside the mask, content must actually change (object gone)
inside = mask > 0
changed = int((diff_out[inside] > 8).sum()) / int(inside.sum())
print(f"CHECK2 inside-mask changed fraction: {changed:.2%} (must be high)")

# CHECK 3: center darkness gone (tattoo removed)
center = out[270:330, 370:430]
print("CHECK3 center mean brightness:", float(center.mean()), "(bg ~150-200, tattoo was ~40)")

cv2.imwrite("/tmp/test_orig.png", test)
cv2.imwrite("/tmp/test_out.png", out)
cv2.imwrite("/tmp/test_mask.png", mask)
print("saved /tmp/test_orig.png /tmp/test_out.png /tmp/test_mask.png")
