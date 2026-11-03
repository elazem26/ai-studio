#!/usr/bin/env python3
"""Debug head-transplant scale: print every size step to find the blow-up."""
import sys
sys.path.insert(0, "/home/z/my-project/mini-services/face-swap-pro")
import numpy as np
import cv2

OUT = "/home/z/my-project/data/test-transplant"
src = cv2.imread(f"{OUT}/portrait_wom_0.img")
ref = cv2.imread(f"{OUT}/portrait_man_1.img")

import server as S
S._ensure_loaded()
faces_src, _, _ = S._detect_sorted(src, hq=True)
faces_ref, _, _ = S._detect_sorted(ref, hq=True)
fs, fr = faces_src[0], faces_ref[0]
print("SRC face bbox:", np.asarray(fs.bbox).astype(int), "kps:", np.asarray(fs.kps).astype(int).tolist())
print("REF face bbox:", np.asarray(fr.bbox).astype(int), "kps:", np.asarray(fr.kps).astype(int).tolist())

kps_s = np.asarray(fs.kps, dtype=np.float32)
kps_r = np.asarray(fr.kps, dtype=np.float32)
M, _ = cv2.estimateAffinePartial2D(kps_r, kps_s, method=cv2.LMEDS)
print("M=", np.round(M, 3).tolist())
scale0 = np.hypot(M[0, 0], M[1, 0])
print("base landmark scale:", round(float(scale0), 3))

SH, SW = src.shape[:2]
warped = cv2.warpAffine(ref, M, (SW, SH), flags=cv2.INTER_LANCZOS4,
                        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
faces_w, _, _ = S._detect_sorted(warped, hq=True)
if faces_w:
    wb = np.asarray(faces_w[0].bbox).astype(int)
    print("WARPED face bbox:", wb, "size:", wb[2]-wb[0], "x", wb[3]-wb[1])
else:
    print("WARPED: no face detected!")
sb = np.asarray(fs.bbox).astype(int)
print("SRC face size:", sb[2]-sb[0], "x", sb[3]-sb[1])
print("=> need would be:", max(1.0, 1.08*(sb[2]-sb[0])/max(1,(wb[2]-wb[0] if faces_w else 1)),
                               1.08*(sb[3]-sb[1])/max(1,(wb[3]-wb[1] if faces_w else 1))))
cv2.imwrite(f"{OUT}/debug_warped.jpg", warped, [cv2.IMWRITE_JPEG_QUALITY, 80])
print("saved debug_warped.jpg")
