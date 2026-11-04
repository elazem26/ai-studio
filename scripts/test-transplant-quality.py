#!/usr/bin/env python3
"""اختبار جودة الدمج: يعيد إنتاج رحلة المستخدم بالضبط (تحديد «الشعر»
للشخص الثاني ثم نقل) ويحفظ النتيجة لفحصها بصرياً — قبل وبعد الإصلاح.
"""
import base64, json, os, sys, time
import urllib.request

BASE = "http://localhost:3030"
OUT = "/home/z/my-project/data/test-seamless"
os.makedirs(OUT, exist_ok=True)

SRC = "/home/z/my-project/data/test-transplant/v3_person_man2woman.png"
REF = "/home/z/my-project/upload/Screenshot 2026-11-02 222740.png"
if not os.path.exists(SRC):
    SRC = "/home/z/my-project/upload/Screenshot 2026-10-29 141534.png"


def post(path, body, timeout=300):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read())
    return resp, time.time() - t0


def durl(path):
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


def save_b64(b64, name):
    if not b64:
        return None
    raw = base64.b64decode(b64.split(",")[-1])
    p = os.path.join(OUT, name)
    with open(p, "wb") as f:
        f.write(raw)
    return p


TAG = sys.argv[1] if len(sys.argv) > 1 else "before"

print(f"== مصدر: {SRC}")
print(f"== مرجع: {REF}")

# 1) كشف الوجوه في المرجع
r, _ = post("/detect", {"image": durl(REF)}, timeout=180)
nf = len(r.get("faces") or [])
print(f"[detect] وجوه المرجع = {nf}")
ref_idx = 1 if nf >= 2 else 0

# 2) تحديد «الشعر» على شخص محدد من المرجع
sel_body = {"image": durl(REF), "text": "الشعر"}
if nf >= 2:
    sel_body["faceIndex"] = ref_idx
r2, t2 = post("/regions/select", sel_body, timeout=240)
assert r2.get("ok"), f"select failed: {r2}"
print(f"[select] الشعر شخص{ref_idx + 1}: area={r2.get('areaPct'):.1f}%  "
      f"bbox={r2.get('bbox')}  ({t2:.1f}s)")
spec = r2.get("spec")
mask_b64 = r2.get("mask")
save_b64(mask_b64, f"{TAG}_ref_mask.png")

# 3) النقل (custom) مع refMask
tr_body = {
    "source": durl(SRC),
    "ref": durl(REF),
    "mode": "custom",
    "refMask": mask_b64,
    "refSpec": spec,
    "sourceIndex": 0,
    "faceIndex": ref_idx,
    "scale": 1.0,
    "colorStrength": 0.6,
}
r3, t3 = post("/transplant", tr_body, timeout=400)
assert r3.get("ok"), f"transplant failed: {r3}"
p = save_b64(r3.get("result"), f"{TAG}_result.png")
print(f"[transplant] ok  ({t3:.1f}s)  -> {p}")
print("DONE")
