#!/usr/bin/env python3
"""اختبار حي لميزة «التحديد بالكتابة + الماوس» — يحاكي رحلة المستخدم:
1) كتابة نص عربي → معاينة التحديد
2) تعديل الكتابة (نص خاطئ ثم أصح) → معاينة تتحدث
3) تكبير التحديد كلامياً (prevSpec + «كبر التحديد»)
4) تطبيق النقل على التحديد النهائي (custom)
كل الخطوات على صور حقيقية موجودة في data/test-transplant/
"""
import base64, json, sys, time
import urllib.request

BASE = "http://localhost:3030"
OUT = "/home/z/my-project/data/test-selection-live"

import os
os.makedirs(OUT, exist_ok=True)


def post(path, body, timeout=180):
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
        print(f"    !! لا توجد صورة في الرد لـ {name}")
        return None
    raw = base64.b64decode(b64.split(",")[-1])
    p = os.path.join(OUT, name)
    with open(p, "wb") as f:
        f.write(raw)
    return p


# اختيار أول صورة حقيقية سليمة فيها وجه (من رفوعات المستخدم ونتائج سابقة)
from PIL import Image
_cands = [
    "/home/z/my-project/upload/Screenshot 2026-11-02 222740.png",
    "/home/z/my-project/upload/Screenshot 2026-10-29 141534.png",
    "/home/z/my-project/data/test-transplant/v3_person_man2woman.png",
    "/home/z/my-project/data/test-transplant/result_via_app.png",
]
_imgs = [p for p in _cands if os.path.exists(p)]
_with_faces = []
for p in _imgs:
    try:
        r0, _ = post("/detect", {"image": durl(p)}, timeout=120)
        if r0.get("ok") and len(r0.get("faces") or []) >= 1:
            _with_faces.append(p)
    except Exception as e:
        print(f"  تجاهل {os.path.basename(p)}: {e}")
if not _with_faces:
    print("لا توجد صورة سليمة فيها وجه — أوقف الاختبار"); sys.exit(1)
SRC = _with_faces[0]          # المرجع: ننقل منه
TGT = _with_faces[1] if len(_with_faces) > 1 else _with_faces[0]  # الهدف
print(f"المرجع: {os.path.basename(SRC)}")
print(f"الهدف: {os.path.basename(TGT)}")
src_img = durl(SRC)
tgt_img = durl(TGT)

print("=" * 62)
print("الخطوة 1: كتابة «الرأس» — أول معاينة")
r, dt = post("/regions/select", {"image": src_img, "text": "الرأس"})
print(f"  ok={r.get('ok')} label={r.get('label')} bbox={r.get('bbox')} "
      f"areaPct={r.get('areaPct')} faces={len(r.get('faces') or [])} ({dt:.1f}s)")
if r.get("ok"):
    save_b64(r.get("overlay"), "s1_head_overlay.png")
    save_b64(r.get("mask"), "s1_head_mask.png")
spec_head = r.get("spec")

print("=" * 62)
print("الخطوة 2: المستخدم كتب نصاً آخر «الشعر» (تكرار حتى يصل للمطلوب)")
r, dt = post("/regions/select", {"image": src_img, "text": "الشعر"})
print(f"  ok={r.get('ok')} label={r.get('label')} bbox={r.get('bbox')} "
      f"areaPct={r.get('areaPct')} ({dt:.1f}s)")
if r.get("ok"):
    save_b64(r.get("overlay"), "s2_hair_overlay.png")
    save_b64(r.get("mask"), "s2_hair_mask.png")
spec_hair = r.get("spec")

print("=" * 62)
print("الخطوة 3: تعديل لفظي على التحديد القائم: «كبر التحديد» (prevSpec)")
r, dt = post("/regions/select", {"image": src_img, "text": "كبر التحديد",
                                 "prevSpec": spec_hair})
print(f"  ok={r.get('ok')} label={r.get('label')} areaPct={r.get('areaPct')} "
      f"expand={((r.get('spec') or {}).get('expand'))} ({dt:.1f}s)")
if r.get("ok"):
    save_b64(r.get("overlay"), "s3_hair_expanded_overlay.png")
    save_b64(r.get("mask"), "s3_hair_expanded_mask.png")
spec_final = r.get("spec")

print("=" * 62)
print("الخطوة 4: نص غير مفهوم (يجب أن يرجع unparsed مع تلميح)")
r, dt = post("/regions/select", {"image": src_img, "text": "طماطم مسلوقة"})
print(f"  ok={r.get('ok')} unparsed={r.get('unparsed')} hint={str(r.get('hint'))[:80]} ({dt:.1f}s)")

print("=" * 62)
print("الخطوة 5: تطبيق النقل (custom) على التحديد النهائي من صورة أخرى")
r, dt = post("/transplant", {
    "source": tgt_img,          # الصورة الهدف
    "ref": src_img,             # الصورة المرجع (ننقل منها)
    "mode": "custom",
    "refSpec": spec_final,      # التحديد المعتمد من الخطوة 3
    "colorStrength": 0.6,
}, timeout=300)
print(f"  ok={r.get('ok')} error={r.get('error')} ({dt:.1f}s)")
if r.get("ok"):
    save_b64(r.get("result") or r.get("image"), "s5_transplanted.png")
    print(f"  keys={ [k for k in r.keys() if r[k] is not None][:12] }")

print("=" * 62)
print(f"تم — النتائج في {OUT}")
