#!/bin/bash
# e2e-part-transplant.sh — atomic start + full E2E for the new
# part-transplant feature (restart server, login, upload, run all modes).
cd /home/z/my-project

echo "== [0] starting stack =="
setsid nohup bash scripts/start-production.sh > data/server.log 2>&1 &
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "307" ]; then break; fi
  sleep 3
done
echo "3000:$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:3000/)"

echo "== [1] login =="
TOKEN=$(curl -s -m 10 -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"mohamed","password":"1970"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOKEN" ]; then echo "LOGIN FAILED"; exit 1; fi
echo "login:OK token=${TOKEN:0:8}…"

echo "== [2] upload source + ref (same face image) =="
S=$(curl -s -m 20 -X POST http://localhost:3000/api/images/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@scripts/face-multi-ref.png;type=image/png")
SP=$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
R=$(curl -s -m 20 -X POST http://localhost:3000/api/images/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@scripts/face-multi-ref.png;type=image/png")
RP=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
echo "source=$SP ref=$RP"
if [ -z "$SP" ] || [ -z "$RP" ]; then echo "UPLOAD FAILED: $S $R"; exit 1; fi

echo "== [2.5] warm models (long first load) =="
curl -s -m 300 "http://localhost:3030/warm" | head -c 120; echo

echo "== [3] transplant mode=head =="
H=$(curl -s -m 130 -X POST http://localhost:3000/api/images/part-transplant \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SP\",\"refPath\":\"$RP\",\"mode\":\"head\"}")
echo "$H" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('url'): print('HEAD OK →', d['url'], d.get('width'),'x',d.get('height'))
else: print('HEAD FAIL:', json.dumps(d, ensure_ascii=False)[:300])
"

echo "== [4] synthetic object test (circle blob) =="
/home/z/.venv/bin/python3 - <<'PYEOF'
from PIL import Image, ImageDraw
import random
# textured background
img = Image.new("RGB", (640, 480))
d = ImageDraw.Draw(img)
random.seed(7)
for y in range(480):
    for seg in range(8):
        c = (30 + y // 10, 60 + seg * 12, 90 + (y * seg) % 60)
        d.rectangle([seg * 80, y, seg * 80 + 79, y], fill=c)
# distinct object (orange ellipse with border)
d.ellipse([220, 140, 430, 340], fill=(240, 130, 30), outline=(255, 255, 255), width=6)
img.save("/tmp/transplant-obj.png")
print("synthetic object image ready")
PYEOF
O=$(curl -s -m 20 -X POST http://localhost:3000/api/images/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/transplant-obj.png;type=image/png")
OP=$(echo "$O" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
echo "obj ref=$OP"

echo "== [5] transplant mode=object (source=face img, ref=object img) =="
J=$(curl -s -m 130 -X POST http://localhost:3000/api/images/part-transplant \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SP\",\"refPath\":\"$OP\",\"mode\":\"object\"}")
echo "$J" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('url'): print('OBJECT OK →', d['url'], d.get('width'),'x',d.get('height'))
else: print('OBJECT FAIL:', json.dumps(d, ensure_ascii=False)[:300])
"

echo "== [6] transplant mode=person + background (smoke) =="
P=$(curl -s -m 130 -X POST http://localhost:3000/api/images/part-transplant \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SP\",\"refPath\":\"$SP\",\"mode\":\"person\"}")
echo "$P" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('PERSON OK →', d.get('url')) if d.get('url') else print('PERSON FAIL:', json.dumps(d, ensure_ascii=False)[:200])
"
B=$(curl -s -m 130 -X POST http://localhost:3000/api/images/part-transplant \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SP\",\"refPath\":\"$SP\",\"mode\":\"background\"}")
echo "$B" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('BACKGROUND OK →', d.get('url')) if d.get('url') else print('BACKGROUND FAIL:', json.dumps(d, ensure_ascii=False)[:200])
"
echo "== DONE =="
