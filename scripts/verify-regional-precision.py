#!/usr/bin/env python3
"""PROOF of regional precision:
   - pixels OUTSIDE the mapped torso box must be 100% IDENTICAL to source
   - pixels INSIDE the box must differ (garment actually changed)
   Also extracts a before/after frame from the quality-pass video."""
import cv2
import numpy as np

SRC = "/home/z/my-project/data/uploads/test-group-3people.png"
RES = "/home/z/my-project/data/results/garment-swap-1793190105846-y9z866.png"

src = cv2.imread(SRC)
res = cv2.imread(RES)
h, w = src.shape[:2]
print("src", src.shape, "res", res.shape)
assert src.shape == res.shape, "size mismatch!"

# person #2 torso box (from detect-persons) + the same padding used by the route
bbox = [0.4246, 0.3515, 0.6087, 1.0]
padX = (bbox[2] - bbox[0]) * 0.16
padY = (bbox[3] - bbox[1]) * 0.10
x1 = max(0, int((bbox[0] - padX) * w)); y1 = max(0, int((bbox[1] - padY) * h))
x2 = min(w, int((bbox[2] + padX) * w)); y2 = min(h, int((bbox[3] + padY) * h))

mask = np.zeros((h, w), bool)
# +3px inward margin: the verification box is allowed to be 1-2px off the
# route's floor/ceil box, so shrink INSIDE and grow OUTSIDE by 3px.
mask[y1 + 3:y2 - 3, x1 + 3:x2 - 3] = True

diff = np.abs(src.astype(int) - res.astype(int)).max(axis=2)
out_diff = diff[~mask]
in_diff = diff[mask]

print("OUTSIDE box: pixels=%d  identical=%d  maxDiff=%.0f  meanDiff=%.4f" % (
    out_diff.size, int((out_diff == 0).sum()), out_diff.max(), out_diff.mean()))
print("INSIDE  box: pixels=%d  changed(>8)=%d (%.1f%%)  meanDiff=%.2f" % (
    in_diff.size, int((in_diff > 8).sum()), 100.0 * (in_diff > 8).mean(), in_diff.mean()))

outside_ok = bool((out_diff == 0).all())
inside_changed = float((in_diff > 8).mean()) > 0.10
print("REGIONAL-PRECISION:", "PASS" if outside_ok and inside_changed else "FAIL")

# ---- video frame compare (face region changed, outside unchanged) ----
orig = cv2.VideoCapture("/home/z/my-project/data/results/test-video.mp4")
swp = cv2.VideoCapture("/home/z/my-project/data/results/video-face-swap-1793190107-968da0.mp4")
o_ok, of = orig.read(); s_ok, sf = swp.read()
if o_ok and s_ok and of.shape == sf.shape:
    od = np.abs(of.astype(int) - sf.astype(int)).max(axis=2)
    chg = (od > 8).mean() * 100
    print("VIDEO frame0: changed pixels = %.2f%% (face swap affects a small region)" % chg)
    cv2.imwrite("/home/z/my-project/data/results/qtest-orig-frame.png", of)
    cv2.imwrite("/home/z/my-project/data/results/qtest-swap-frame.png", sf)
    print("frames saved for visual check")
else:
    print("video shapes differ or read failed", of.shape if o_ok else None, sf.shape if s_ok else None)
