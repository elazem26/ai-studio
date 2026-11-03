#!/usr/bin/env python3
"""Full app-flow e2e: login -> upload source & ref -> part-transplant."""
import base64, json, urllib.request, uuid, http.cookiejar

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

r = op.open(urllib.request.Request(
    "http://localhost:3000/api/auth/login",
    data=json.dumps({"email": "mohamed", "password": "1970"}).encode(),
    headers={"Content-Type": "application/json"}), timeout=30)
print("login:", r.status)

def upload(p):
    boundary = uuid.uuid4().hex
    data = open(p, "rb").read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{p.split('/')[-1]}\"\r\nContent-Type: image/png\r\n\r\n"
            ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    r = op.open(urllib.request.Request(
        "http://localhost:3000/api/images/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}), timeout=60)
    d = json.loads(r.read().decode())
    return d.get("path") or d.get("url") or d

sp = upload("/home/z/my-project/data/test-transplant/portrait_wom_0.img")
rp = upload("/home/z/my-project/data/test-transplant/portrait_man_1.img")
print("uploaded:", str(sp)[:80], "|", str(rp)[:80])

payload = {"sourcePath": sp, "refPath": rp, "mode": "head", "region": "full", "colorStrength": 0.7}
r = op.open(urllib.request.Request(
    "http://localhost:3000/api/images/part-transplant",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"}), timeout=240)
d = json.loads(r.read().decode())
print("transplant ok:", d.get("ok", d.get("url", "?")), "| mode:", d.get("mode"))
if d.get("url"):
    img = op.open("http://localhost:3000" + d["url"], timeout=60).read()
    open("/home/z/my-project/data/test-transplant/result_via_app.png", "wb").write(img)
    print("saved result_via_app.png", len(img), "bytes")
else:
    print(json.dumps(d)[:300])
