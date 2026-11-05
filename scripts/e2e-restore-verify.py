#!/usr/bin/env python3
"""Post-restore E2E: upload a fresh image (verify fix E persistent dir),
then run select tests (fixes A/B/C) through port 3000."""
import io, json, urllib.request, uuid, os, time
from PIL import Image, ImageDraw

BASE = "http://localhost:3000"

def upload_img():
    img = Image.new("RGB", (900, 1200), (70, 110, 160))
    d = ImageDraw.Draw(img)
    d.rectangle([300, 200, 600, 520], fill=(205, 170, 140))   # face-ish block
    d.rectangle([260, 520, 640, 1050], fill=(30, 60, 110))    # body block
    buf = io.BytesIO(); img.save(buf, "PNG")
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + buf.getvalue() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + "/api/images/upload", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

up = upload_img()
print("upload ok:", up.get("ok"), "path:", up.get("path"))
fn = os.path.basename(up.get("path", "x"))
print("fixE-live: persistent_dir=%s legacy_dir=%s" % (
    os.path.exists("/home/z/my-project/data/uploads/" + fn),
    os.path.exists("/home/z/my-project/.next/standalone/data/uploads/" + fn)))

REF = up.get("url")  # frontend sends data.url as refPath
# نص المستخدم الحرفي + الأزرار الرئيسية
TEXTS = ["الصدر", "الخلفية", "الرأس", "بحر", "خلفية بحر",
         "اختر عن المكان يعني التحديد", "الشخص الثاني"]
for t in TEXTS:
    t0 = time.time()
    b = json.dumps({"text": t, "refPath": REF, "side": "ref"}).encode()
    req = urllib.request.Request(BASE + "/api/images/part-transplant/select", data=b,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read())
            print(f"«{t}» ok={d.get('ok')} label={d.get('label','')} area={d.get('areaPct','')} "
                  f"viaLLM={d.get('viaLLM', False)} {time.time()-t0:.1f}s err={(d.get('error') or '')[:50]!r}")
    except Exception as e:
        print(f"«{t}» FAIL {type(e).__name__}: {str(e)[:80]}")
