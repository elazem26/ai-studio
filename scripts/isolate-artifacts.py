# -*- coding: utf-8 -*-
"""عزل مصدر البقع البيضاء: inswapper خالص مقابل inswapper+_enhance_face."""
import sys, importlib.util
import numpy as np
import cv2

spec = importlib.util.spec_from_file_location(
    "fsp", "/home/z/my-project/mini-services/face-swap-pro/server.py")
fsp = importlib.util.module_from_spec(spec)
sys.modules["fsp"] = fsp
spec.loader.exec_module(fsp)

TD = "/home/z/my-project/data/test-transplant/"

def load(p):
    d = np.fromfile(p, np.uint8)
    return cv2.imdecode(d, 1)

wom = load(TD + "portrait_wom_0.img")
man = load(TD + "ref_manA.jpg")
if max(wom.shape[:2]) > 1600:
    s = 1600 / max(wom.shape[:2])
    wom = cv2.resize(wom, (int(wom.shape[1] * s), int(wom.shape[0] * s)))

fsp._ensure_loaded()
fs, _, _ = fsp._detect_sorted(wom, hq=True)
fr, _, _ = fsp._detect_sorted(man, hq=True)
assert fs and fr, "detection failed"

raw = fsp.SWAPPER.get(wom, fs[0], fr[0], paste_back=True)
cv2.imwrite(TD + "iso_raw_swap.png", raw)

enh = fsp._enhance_face(raw.copy(), wom, tuple(int(v) for v in np.asarray(fs[0].bbox).flatten()))
cv2.imwrite(TD + "iso_enh_swap.png", enh)

H = 560
def rs(im, lb):
    s = H / im.shape[0]
    im = cv2.resize(im, (int(im.shape[1] * s), H))
    cv2.rectangle(im, (0, 0), (im.shape[1], 34), (0, 0, 0), -1)
    cv2.putText(im, lb, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    return im

cols = [rs(raw, "RAW inswapper"), rs(enh, "ENHANCED")]
W = sum(c.shape[1] for c in cols) + 8
canvas = np.full((H, W, 3), 255, np.uint8)
x = 0
for c in cols:
    canvas[:, x:x + c.shape[1]] = c
    x += c.shape[1] + 8
cv2.imwrite(TD + "iso_cmp.jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
print("ISO DONE")
