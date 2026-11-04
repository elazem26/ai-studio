#!/usr/bin/env python3
"""اختيار صورتي اختبار نظيفتين (فيها وجوه واضحة) من رفوعات المستخدم."""
import base64, json, os, sys
import urllib.request

BASE = "http://localhost:3030"


def post(path, body, timeout=120):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def durl(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


ups = sorted(
    [os.path.join("/home/z/my-project/upload", f) for f in os.listdir("/home/z/my-project/upload")
     if f.lower().endswith((".png", ".jpg", ".jpeg"))],
    key=os.path.getmtime, reverse=True)

good = []
for p in ups[:14]:
    try:
        im_h, im_w = None, None
        from PIL import Image
        im = Image.open(p)
        if max(im.size) < 500:      # tiny screenshots skip
            continue
        r = post("/detect", {"image": durl(p)})
        n = len(r.get("faces") or [])
        print(f"{os.path.basename(p):44s} faces={n} size={im.size}")
        if n >= 1 and max(im.size) >= 700:
            good.append((p, n))
    except Exception as e:
        print(f"{os.path.basename(p):44s} ERR {e}")

print("---")
for p, n in good[:8]:
    print(p)
