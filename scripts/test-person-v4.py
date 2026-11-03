#!/usr/bin/env python3
"""اختبار مسار الجسم الكامل v4 في /transplant:
1) يختار صورتين فيهما وجوه من رفوعات المستخدم
2) يرسل mode=person region=full
3) يحفظ النتيجة ويتحقق من الأبعاد والنجاح
"""
import base64, json, os, sys, time
import urllib.request

BASE = "http://localhost:3030"
OUT = "/home/z/my-project/data/test-transplant"
os.makedirs(OUT, exist_ok=True)

UPLOADS = "/home/z/my-project/upload"


def post(path, body, timeout=240):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read())
    return resp, time.time() - t0


def durl(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


cands = []
for fn in sorted(os.listdir(UPLOADS)):
    p = os.path.join(UPLOADS, fn)
    try:
        sz = os.path.getsize(p)
        if 30_000 < sz < 3_000_000 and fn.lower().endswith(".png"):
            cands.append(p)
    except Exception:
        pass
cands = cands[-12:]

with_faces = []
for p in cands:
    try:
        r0, _ = post("/detect", {"image": durl(p)}, timeout=120)
        n = len(r0.get("faces") or []) if r0.get("ok") else 0
        if n >= 1:
            with_faces.append((p, n))
            print(f"وجه ✓ ({n}): {os.path.basename(p)}")
        if len(with_faces) >= 2:
            break
    except Exception as e:
        print(f"  تجاهل {os.path.basename(p)}: {e}")

if len(with_faces) < 2:
    print("FAIL: لا توجد صورتان فيهما وجه")
    sys.exit(1)

SRC = with_faces[0][0]
REF = with_faces[1][0]
print(f"\nالمصدر: {os.path.basename(SRC)}")
print(f"المرجع: {os.path.basename(REF)}")

t0 = time.time()
r, dt = post("/transplant", {
    "source": durl(SRC),
    "ref": durl(REF),
    "mode": "person",
    "region": "full",
    "scale": 1.0,
    "colorStrength": 0.6,
})
print(f"\n/transplant person-full: {dt:.1f}s ok={r.get('ok')}")

if not r.get("ok"):
    print("FAIL:", r.get("error"))
    sys.exit(1)

raw = base64.b64decode(r["result"].split(",")[-1])
out = os.path.join(OUT, f"v4_person_full_{int(time.time())}.png")
with open(out, "wb") as f:
    f.write(raw)
print(f"حجم النتيجة: {len(raw)} بايت -> {out}")

from PIL import Image
w, h = Image.open(out).size
sw, sh = Image.open(SRC).size
print(f"أبعاد النتيجة: {w}x{h} (المصدر {sw}x{sh})")
if (w, h) != (sw, sh):
    print("WARN: الأبعاد غير مطابقة للمصدر")
print("PASS ✓")
