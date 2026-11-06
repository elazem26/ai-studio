#!/usr/bin/env python3
"""اختبار جودة الدمج بعد التحديث — نقل رأس (inswapper) ونقل شعر (custom)
على صور حقيقية، ثم حفظ النتائج للفحص البصري."""
import base64, json, os, sys, time
import urllib.request

BASE = "http://localhost:3030"
OUT = "/home/z/my-project/data/update-test"
os.makedirs(OUT, exist_ok=True)


def post(path, body, timeout=300):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()), time.time() - t0


def durl(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def save_b64(b64, name):
    if not b64:
        print(f"  !! لا توجد صورة في الرد لـ {name}")
        return None
    raw = base64.b64decode(b64.split(",")[-1])
    p = os.path.join(OUT, name)
    with open(p, "wb") as f:
        f.write(raw)
    return p


SRC = "/tmp/photo_a.png"  # المرجع
TGT = "/tmp/photo_b.png"  # الهدف
for p in (SRC, TGT):
    if not os.path.exists(p):
        print(f"مفقود: {p}")
        sys.exit(1)

ref_img = durl(SRC)
tgt_img = durl(TGT)

# اختبار أ: نقل رأس كامل (مسار inswapper المتفوق)
print("=" * 60)
print("اختبار أ: mode=head (تبديل الهوية عبر inswapper)")
r, dt = post("/transplant", {
    "source": tgt_img, "ref": ref_img, "mode": "head",
    "colorStrength": 0.6,
}, timeout=300)
print(f"  ok={r.get('ok')} error={r.get('error')} ({dt:.1f}s)")
if r.get("ok"):
    save_b64(r.get("result") or r.get("image"), "a_head.png")

# اختبار ب: نقل «الشعر» فقط (مسار custom بقناع + حارس)
print("=" * 60)
print("اختبار ب: تحديد «الشعر» نصياً ثم نقله (custom)")
r1, dt1 = post("/regions/select", {"image": ref_img, "text": "الشعر"}, timeout=180)
print(f"  select ok={r1.get('ok')} label={r1.get('label')} areaPct={r1.get('areaPct')} ({dt1:.1f}s)")
if r1.get("ok"):
    r2, dt2 = post("/transplant", {
        "source": tgt_img, "ref": ref_img, "mode": "custom",
        "refSpec": r1.get("spec"), "colorStrength": 0.6,
    }, timeout=300)
    print(f"  transplant ok={r2.get('ok')} error={r2.get('error')} ({dt2:.1f}s)")
    if r2.get("ok"):
        save_b64(r2.get("result") or r2.get("image"), "b_hair.png")

print("=" * 60)
print(f"تم — النتائج في {OUT}")
