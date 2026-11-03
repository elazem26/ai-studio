#!/usr/bin/env bash
# E2E through the real app: login -> part-transplant via :3000
set -e
cd /home/z/my-project
IMG=/home/z/my-project/data/test-transplant/portrait_wom_0.img
REF=/home/z/my-project/data/test-transplant/portrait_man_1.img

python3 - <<'EOF'
import base64, json, urllib.request

def b64(p):
    return "data:image/jpeg;base64," + base64.b64encode(open(p, 'rb').read()).decode()

# 1) login (cookie jar)
import http.cookiejar
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
r = op.open(urllib.request.Request(
    "http://localhost:3000/api/auth/login",
    data=json.dumps({"email": "mohamed", "password": "1970"}).encode(),
    headers={"Content-Type": "application/json"}), timeout=30)
print("login:", r.status, json.loads(r.read().decode()).get("ok", "?"))

# 2) part-transplant through the app route
payload = {"source": b64("/home/z/my-project/data/test-transplant/portrait_wom_0.img"),
           "ref": b64("/home/z/my-project/data/test-transplant/portrait_man_1.img"),
           "mode": "head", "region": "full", "colorStrength": 0.7}
r = op.open(urllib.request.Request(
    "http://localhost:3000/api/images/part-transplant",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"}), timeout=240)
d = json.loads(r.read().decode())
print("transplant ok:", d.get("ok"), "| mode:", d.get("mode"))
if d.get("ok"):
    img = d["result"].split(",", 1)[1]
    open("/home/z/my-project/data/test-transplant/result_via_app.png", "wb").write(base64.b64decode(img))
    print("saved result_via_app.png")
else:
    print("error:", d.get("error"))
EOF
