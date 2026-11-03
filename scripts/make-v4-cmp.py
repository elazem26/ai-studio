#!/usr/bin/env python3
"""مقارنة بصرية صغيرة: المصدر | المرجع | النتيجة v4"""
import glob, sys
from PIL import Image

src = "/home/z/my-project/upload/Screenshot 2026-10-29 201847.png"
ref = "/home/z/my-project/upload/Screenshot 2026-11-02 222740.png"
res = sorted(glob.glob("/home/z/my-project/data/test-transplant/v4_person_full_*.png"))[-1]

imgs = [Image.open(p).convert("RGB") for p in (src, ref, res)]
H = 360
tiles = []
for im in imgs:
    w = int(im.width * H / im.height)
    tiles.append(im.resize((w, H)))
W = sum(t.width for t in tiles) + 20
canvas = Image.new("RGB", (W, H), (18, 18, 18))
x = 0
for t in tiles:
    canvas.paste(t, (x, 0))
    x += t.width + 10
canvas.save("/home/z/my-project/data/test-transplant/v4_cmp_small.jpg", quality=80)
print("saved", canvas.size)
