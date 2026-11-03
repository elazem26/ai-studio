#!/usr/bin/env python3
"""Test the fixed /transplant endpoint: head + person + arms modes.
Produces side-by-side comparison images (source | ref | result) downscaled
for quick visual inspection of ghost/seam artifacts."""
import base64
import json
import sys
import urllib.request

import cv2
import numpy as np

BASE = "http://localhost:3030/transplant"
TDIR = "/home/z/my-project/data/test-transplant"
OUT = "/home/z/my-project/data/test-transplant"


def b64(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def call(payload, name):
    req = urllib.request.Request(
        BASE, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"[{name}] HTTP {e.code}: {e.read().decode()[:200]}")
        return None
    if not data.get("ok"):
        print(f"[{name}] ERROR: {data.get('error')}")
        return None
    raw = base64.b64decode(data["result"].split(",", 1)[1])
    arr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    out_path = f"{OUT}/fix_{name}.png"
    cv2.imwrite(out_path, img)
    print(f"[{name}] OK -> {out_path} {img.shape[1]}x{img.shape[0]}")
    return img


def side_by_side(src_p, ref_p, res_img, name):
    if res_img is None:
        return
    s = cv2.imread(src_p)
    r = cv2.imread(ref_p)
    H = 420
    def rs(im):
        k = H / im.shape[0]
        return cv2.resize(im, (int(im.shape[1] * k), H), interpolation=cv2.INTER_AREA)
    s, r, q = rs(s), rs(r), rs(res_img)
    gap = np.full((H, 12, 3), 255, np.uint8)
    row = np.hstack([s, gap, r, gap, q])
    cv2.imwrite(f"{OUT}/fixcmp_{name}.jpg", row, [cv2.IMWRITE_JPEG_QUALITY, 82])
    print(f"[{name}] comparison -> fixcmp_{name}.jpg")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "head"
    src, ref = f"{TDIR}/ref_manA.jpg", f"{TDIR}/gen_woman.png"
    if which == "head":
        img = call({"source": b64(src), "ref": b64(ref), "mode": "head"}, "head")
        side_by_side(src, ref, img, "head")
    elif which == "person":
        src, ref = f"{TDIR}/ref_manB.jpg", f"{TDIR}/gen_woman.png"
        img = call({"source": b64(src), "ref": b64(ref), "mode": "person",
                    "sourceIndex": 1}, "person")
        side_by_side(src, ref, img, "person")
    elif which == "arms":
        src, ref = f"{TDIR}/gen_woman.png", f"{TDIR}/ref_man2.jpg"
        img = call({"source": b64(src), "ref": b64(ref), "mode": "person",
                    "region": "arms"}, "arms")
        side_by_side(src, ref, img, "arms")
