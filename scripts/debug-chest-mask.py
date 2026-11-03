"""Debug the chest region mask pipeline standalone (no service needed)."""
import sys
import numpy as np
import cv2

sys.path.insert(0, "/home/z/my-project/mini-services/face-swap-pro")
import importlib.util
spec = importlib.util.spec_from_file_location(
    "fsp", "/home/z/my-project/mini-services/face-swap-pro/server.py")
fsp = importlib.util.module_from_spec(spec)
# prevent uvicorn from running: import only the functions we need
import types

src_text = open("/home/z/my-project/mini-services/face-swap-pro/server.py").read()
# strip the uvicorn run block if any
mod = types.ModuleType("fsp")
mod.__file__ = "/home/z/my-project/mini-services/face-swap-pro/server.py"
exec(compile(src_text, "server.py", "exec"), mod.__dict__)

T = "/home/z/my-project/data/test-transplant/"
ref = cv2.imread(T + "gen_woman.png")
RH, RW = ref.shape[:2]
faces_ref, _, _ = mod._detect_sorted(ref, hq=True)
print("ref faces:", len(faces_ref))
f = faces_ref[0]
fx1, fy1, fx2, fy2 = mod._face_rect(f)
fw, fh = fx2 - fx1, fy2 - fy1
print("face rect:", fx1, fy1, fx2, fy2)

m_full = mod._subject_mask_full(ref, None)
print("subject mask px:", int((m_full > 100).sum()))
cv2.imwrite("/tmp/dbg_m_full.png", m_full)

band_top = max(0, int(fy1 + 1.02 * fh))
band_bot = min(RH, int(fy1 + 1.85 * fh))
print("band:", band_top, band_bot, "RH:", RH)
band = np.zeros((RH, RW), np.uint8)
band[band_top:band_bot, :] = 255
region_mask = cv2.multiply(m_full, band, scale=1.0 / 255.0)
cv2.imwrite("/tmp/dbg_region_band.png", region_mask)

# hair sample
hy1, hy2 = max(0, int(fy1 - 0.75 * fw)), max(0, int(fy1 - 0.05 * fw))
hx1, hx2 = max(0, int(fx1 - 0.45 * fw)), min(RW, int(fx2 + 0.45 * fw))
print("hair band:", hx1, hy1, hx2, hy2)
hs = np.zeros((RH, RW), np.uint8)
cv2.rectangle(hs, (hx1, hy1), (hx2, hy2), 255, -1)
hair_px = cv2.bitwise_and(m_full, hs)
hair_sel = hair_px > 120
print("hair sample px:", int(hair_sel.sum()))
cv2.imwrite("/tmp/dbg_hair_sample.png", hair_px)
ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
hm = ref_lab[hair_sel]
mu, sd = hm.mean(0), hm.std(0) + 1e-6
print("hair LAB mean:", mu.round(1), "std:", sd.round(1))
d = np.sqrt(((ref_lab - mu.reshape(1, 1, 3)) / sd.reshape(1, 1, 3)) ** 2).sum(axis=2)
for thr in (4.0, 6.0, 8.0, 12.0):
    like = ((d < thr) & (region_mask > 40))
    print(f"thr={thr}: hair-like px in region = {int(like.sum())}")
like = ((d < 6.0) & (region_mask > 40)).astype(np.uint8) * 255
cv2.imwrite("/tmp/dbg_hair_like.png", like)
ys, xs = np.where(region_mask > 100)
print("region bbox:", xs.min(), xs.max(), ys.min(), ys.max())
