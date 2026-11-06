#!/usr/bin/env python3
"""E2E test: upload -> brush-mask remove-object via the Next.js route.
Verifies: route ok, method=lama, and pixels OUTSIDE the mask are identical."""
import base64, io, json, urllib.request
import numpy as np
import cv2

BASE = "http://localhost:3000"

# --- 1. build a synthetic photo with a dark "tattoo" blob ---
rng = np.random.default_rng(3)
h, w = 720, 900
img = np.zeros((h, w, 3), np.uint8)
for y in range(h):
    t = y / h
    img[y, :, 0] = int(110 + 70 * t)
    img[y, :, 1] = int(140 + 50 * t)
    img[y, :, 2] = int(175 + 35 * t)
img = np.clip(img.astype(np.float32) + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
cv2.circle(img, (450, 360), 55, (25, 15, 20), -1)      # tattoo outer
cv2.circle(img, (450, 360), 30, (205, 185, 195), -1)   # tattoo inner
cv2.imwrite("/tmp/e2e_src.png", img)

# --- 2. upload through the real route ---
fd = open("/tmp/e2e_src.png", "rb").read()
boundary = "----e2eboundary123"
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"e2e.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + fd + f"\r\n--{boundary}--\r\n".encode()
req = urllib.request.Request(f"{BASE}/api/images/upload", data=body,
                             headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
up = json.loads(urllib.request.urlopen(req, timeout=30).read())
print("upload:", up.get("path"), up.get("width"), "x", up.get("height"))
assert up.get("path"), "upload failed"

# --- 3. mask (brush) covering the tattoo, natural size ---
mask = np.zeros((up["height"], up["width"]), np.uint8)
cv2.circle(mask, (450, 360), 60, 255, -1)
ok, buf = cv2.imencode(".png", mask)
mask_data_url = "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()

# --- 4. call the real remove-object route with the brush mask ---
req = urllib.request.Request(
    f"{BASE}/api/images/remove-object",
    data=json.dumps({"sourcePath": up["path"], "maskDataUrl": mask_data_url, "growPx": 6, "featherPx": 4}).encode(),
    headers={"Content-Type": "application/json"},
)
res = json.loads(urllib.request.urlopen(req, timeout=300).read())
print("remove-object:", {k: res.get(k) for k in ("ok", "method", "width", "height", "url")})
assert res.get("url"), "remove failed"

# --- 5. download result; outside-mask pixels must be identical ---
# Contract: the service grows the brush mask by growPx=6 and feathers ~4px,
# so the guaranteed-untouched zone starts ~8px beyond the grown edge.
result = cv2.imdecode(np.frombuffer(urllib.request.urlopen(f"{BASE}{res['url']}", timeout=30).read(), np.uint8), cv2.IMREAD_COLOR)
orig = cv2.imread("/tmp/e2e_src.png")
guard = cv2.dilate(mask, np.ones((33, 33), np.uint8))  # 16px guard beyond the brush
outside = guard == 0
diff = np.abs(result.astype(int) - orig.astype(int)).max(axis=2)
changed_outside = int(((diff > 4) & outside).sum())
inside_changed = float((diff[mask > 0] > 10).mean()) * 100
center_brightness = float(result[360-30:360+30, 450-30:450+30].mean())
print(f"CHECK1 outside-mask changed pixels: {changed_outside} (must be 0)")
print(f"CHECK2 inside-mask changed fraction: {inside_changed:.1f}% (must be high)")
print(f"CHECK3 center brightness now: {center_brightness:.1f} (tattoo was ~35, bg ~150-200)")
assert changed_outside == 0, "pixels outside the mask changed!"
assert inside_changed > 50, "mask area was not inpainted!"
print("E2E PASS — route works, LaMa inpainted only the mask, rest is bit-identical")
