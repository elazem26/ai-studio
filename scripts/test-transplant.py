# -*- coding: utf-8 -*-
"""اختبار مباشر لنقطة /transplant بعد إعادة الكتابة (رأس + شخص)."""
import base64, json, sys, time
import urllib.request
import numpy as np
import cv2

BASE = "http://localhost:3030"

def load_bgr(p):
    data = np.fromfile(p, dtype=np.uint8)  # .img files are actually jpeg bytes
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    assert img is not None, "cannot decode " + p
    return img

def data_url(img):
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()

def post(path, payload, timeout=300):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read().decode())
        return out, time.time() - t0

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

TD = "/home/z/my-project/data/test-transplant/"

# ---------- HEAD: man (ref) -> woman (source) ----------
wom = load_bgr(TD + "portrait_wom_0.img")
man = load_bgr(TD + "portrait_man_0.img")

out, dt = post("/transplant", {"source": data_url(wom), "ref": data_url(man),
                               "mode": "head", "colorStrength": 0.6})
if not out.get("ok"):
    print("HEAD FAIL:", out.get("error")); sys.exit(1)
res = cv2.imdecode(np.frombuffer(base64.b64decode(out["result"].split(",", 1)[1]), np.uint8), 1)
cv2.imwrite(TD + "v3_head_man2woman.png", res)
print("HEAD ok %.1fs -> v3_head_man2woman.png %s" % (dt, res.shape))

cmp = hstack_labels([wom, man, res], ["SOURCE (woman)", "REF (man)", "RESULT v3 head"])
cv2.imwrite(TD + "v3_cmp_head.jpg", cmp, [cv2.IMWRITE_JPEG_QUALITY, 88])

# ---------- HEAD: woman (ref) -> man (source) ----------
out2, dt2 = post("/transplant", {"source": data_url(man), "ref": data_url(wom),
                                 "mode": "head", "colorStrength": 0.6})
if out2.get("ok"):
    res2 = cv2.imdecode(np.frombuffer(base64.b64decode(out2["result"].split(",", 1)[1]), np.uint8), 1)
    cv2.imwrite(TD + "v3_head_woman2man.png", res2)
    print("HEAD rev ok %.1fs -> v3_head_woman2man.png" % dt2)
    cmp2 = hstack_labels([man, wom, res2], ["SOURCE (man)", "REF (woman)", "RESULT v3 head"])
    cv2.imwrite(TD + "v3_cmp_head_rev.jpg", cmp2, [cv2.IMWRITE_JPEG_QUALITY, 88])
else:
    print("HEAD rev FAIL:", out2.get("error"))

# ---------- PERSON: man (ref) -> woman scene ----------
out3, dt3 = post("/transplant", {"source": data_url(wom), "ref": data_url(man),
                                 "mode": "person", "colorStrength": 0.6})
if out3.get("ok"):
    res3 = cv2.imdecode(np.frombuffer(base64.b64decode(out3["result"].split(",", 1)[1]), np.uint8), 1)
    cv2.imwrite(TD + "v3_person_man2woman.png", res3)
    print("PERSON ok %.1fs -> v3_person_man2woman.png" % dt3)
else:
    print("PERSON FAIL:", out3.get("error"))

print("ALL DONE")
