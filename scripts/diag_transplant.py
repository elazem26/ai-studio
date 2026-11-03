#!/usr/bin/env python3
"""Contact sheet: user's actual source / ref / failed results (Nov 2 19:25-19:27)."""
import cv2
import numpy as np

UP = "/home/z/my-project/.next/standalone/data/uploads"
RES = "/home/z/my-project/.next/standalone/data/results"

src = cv2.imread(f"{UP}/mvznhjgk-eb70b7af67ec.jpg")   # 864KB latest
ref1 = cv2.imread(f"{UP}/mvzngkpt-a1efc99f4fe4.jpg")  # 92KB
ref2 = cv2.imread(f"{UP}/mvzng2qy-5037dcf62036.jpg")  # 157KB
out1 = cv2.imread(f"{RES}/part-transplant-1793647637059-y8fjsm.png")  # 19:27
out2 = cv2.imread(f"{RES}/part-transplant-1793647597268-0tbeqe.png")  # 19:26

tiles = []
for name, im in [("src", src), ("ref1", ref1), ("ref2", ref2), ("out_1927", out1), ("out_1926", out2)]:
    if im is None:
        print(name, "MISSING")
        continue
    h, w = im.shape[:2]
    s = 420 / max(h, w)
    im2 = cv2.resize(im, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    canvas = np.full((420, 420, 3), 30, np.uint8)
    y0 = (420 - im2.shape[0]) // 2
    x0 = (420 - im2.shape[1]) // 2
    canvas[y0:y0 + im2.shape[0], x0:x0 + im2.shape[1]] = im2
    cv2.putText(canvas, name, (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
    tiles.append(canvas)
    print(name, im.shape)

row1 = np.hstack(tiles[:3]) if len(tiles) >= 3 else None
row2 = np.hstack(tiles[3:]) if len(tiles) > 3 else None
rows = [r for r in (row1, row2) if r is not None]
wmax = max(r.shape[1] for r in rows)
sheet = []
for r in rows:
    if r.shape[1] < wmax:
        pad = np.full((r.shape[0], wmax - r.shape[1], 3), 30, np.uint8)
        r = np.hstack([r, pad])
    sheet.append(r)
out = np.vstack(sheet)
cv2.imwrite("/home/z/my-project/data/test-transplant/diag_user_case.jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 88])
print("sheet:", out.shape)
