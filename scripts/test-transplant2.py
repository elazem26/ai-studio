# -*- coding: utf-8 -*-
"""اختبار v3 بمراجع نظيفة: توم هانكس (insightface) كبيرجع."""
import base64, json
import urllib.request
import numpy as np
import cv2

BASE = "http://localhost:3030"
TD = "/home/z/my-project/data/test-transplant/"
HK = TD + "ref_manA.jpg"

def load_bgr(p):
    d = np.fromfile(p, np.uint8)
    im = cv2.imdecode(d, cv2.IMREAD_COLOR)
    return im

def data_url(img):
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()

def post(path, payload, timeout=300):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def hstack_labels(imgs, labels):
    H = 480
    cols = []
    for im, lb in zip(imgs, labels):
        s = H / im.shape[0]
        im = cv2.resize(im, (int(im.shape[1] * s), H))
        cv2.rectangle(im, (0, 0), (im.shape[1], 34), (0, 0, 0), -1)
        cv2.putText(im, lb, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cols.append(im)
    W = sum(c.shape[1] for c in cols) + 8 * (len(cols) - 1)
    canvas = np.full((H, W, 3), 255, np.uint8)
    x = 0
    for c in cols:
        canvas[:, x:x + c.shape[1]] = c
        x += c.shape[1] + 8
    return canvas

wom = load_bgr(TD + "portrait_wom_0.img")
hks = load_bgr(HK)
assert wom is not None and hks is not None

# HEAD: hanks (ref) -> woman (source)
out = post("/transplant", {"source": data_url(wom), "ref": data_url(hks),
                           "mode": "head", "colorStrength": 0.6})
assert out.get("ok"), out.get("error")
res = cv2.imdecode(np.frombuffer(base64.b64decode(out["result"].split(",", 1)[1]), np.uint8), 1)
cv2.imwrite(TD + "v3_head_hanks2wom.png", res)
cmp = hstack_labels([wom, hks, res], ["SOURCE (woman)", "REF (hanks)", "RESULT v3"])
cv2.imwrite(TD + "v3_cmp_hanks2wom.jpg", cmp, [cv2.IMWRITE_JPEG_QUALITY, 88])
print("hanks->wom OK", res.shape)

# HEAD reverse: woman (ref) -> hanks (source)
out2 = post("/transplant", {"source": data_url(hks), "ref": data_url(wom),
                            "mode": "head", "colorStrength": 0.6})
assert out2.get("ok"), out2.get("error")
res2 = cv2.imdecode(np.frombuffer(base64.b64decode(out2["result"].split(",", 1)[1]), np.uint8), 1)
cv2.imwrite(TD + "v3_head_wom2hanks.png", res2)
cmp2 = hstack_labels([hks, wom, res2], ["SOURCE (hanks)", "REF (woman)", "RESULT v3"])
cv2.imwrite(TD + "v3_cmp_wom2hanks.jpg", cmp2, [cv2.IMWRITE_JPEG_QUALITY, 88])
print("wom->hanks OK", res2.shape)
print("DONE")
