#!/bin/bash
# ============================================================
# e2e-transplant.sh — full end-to-end proof in ONE call:
#   login → upload source+reference → POST /api/images/transplant
#   (brush mask as data URL) → verify PNG result
# ============================================================
set -u
P=/home/z/my-project
cd "$P"
BASE="${1:-http://localhost:3000}"
echo "E2E base: $BASE"

echo "[1/6] generating synthetic test images..."
/home/z/.venv/bin/python3 - <<'PYEOF'
import cv2, numpy as np
src = np.zeros((800,1200,3), np.uint8)
for x in range(1200): src[:,x] = (40, 120+int(80*x/1200), 60)
cv2.rectangle(src,(520,380),(680,800),(70,90,140),-1)
cv2.imwrite('/tmp/tp-src.png', src)
ref = np.full((900,900,3),(180,90,40),np.uint8)
cv2.circle(ref,(450,480),190,(60,60,220),-1)
cv2.ellipse(ref,(450,330),(200,90),0,180,360,(40,40,160),-1)
cv2.circle(ref,(390,440),28,(240,240,240),-1)
cv2.imwrite('/tmp/tp-ref.png', ref)
mask = np.zeros((900,900), np.uint8)
cv2.ellipse(mask,(450,420),(230,210),0,0,360,255,-1)
import base64
ok, buf = cv2.imencode('.png', cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR))
open('/tmp/tp-mask.json','w').write('data:image/png;base64,'+base64.b64encode(buf.tobytes()).decode())
print('images ready')
PYEOF

echo "[2/6] login..."
curl -s -c /tmp/tp-cookies.txt -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"mohamed","password":"1970"}' -o /tmp/tp-login.json -w "login HTTP %{http_code}\n"

echo "[3/6] upload source + reference..."
UP=$(curl -s -b /tmp/tp-cookies.txt -X POST "$BASE/api/images/upload" -F "file=@/tmp/tp-src.png")
SRC_PATH=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
UP2=$(curl -s -b /tmp/tp-cookies.txt -X POST "$BASE/api/images/upload" -F "file=@/tmp/tp-ref.png")
REF_PATH=$(echo "$UP2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
[ -n "$SRC_PATH" ] && [ -n "$REF_PATH" ] || { echo "FATAL: upload failed: $UP / $UP2"; exit 1; }
echo "source: $SRC_PATH"
echo "ref:    $REF_PATH"

echo "[4/6] build transplant payload..."
python3 - "$SRC_PATH" "$REF_PATH" <<'PYEOF'
import json, sys
src_path, ref_path = sys.argv[1], sys.argv[2]
mask = open('/tmp/tp-mask.json').read()
payload = {
    "sourcePath": src_path, "refPath": ref_path,
    "mask": mask,
    "cx": 0.5, "cy": 0.42, "w": 0.38,
    "rotate": 0, "flip": False,
    "colorMatch": 0.7, "blend": "seamless", "feather": 18,
}
open('/tmp/tp-payload.json','w').write(json.dumps(payload))
print('payload ready')
PYEOF

echo "[5/6] POST /api/images/transplant..."
RES=$(curl -s -m 180 -b /tmp/tp-cookies.txt -X POST "$BASE/api/images/transplant" \
  -H "Content-Type: application/json" \
  -d @/tmp/tp-payload.json)
echo "$RES" | head -c 300; echo
RESULT_URL=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
[ -n "$RESULT_URL" ] || { echo "FATAL: transplant failed"; exit 1; }
echo "result URL: $RESULT_URL"

echo "[6/6] fetch result + verify PNG..."
curl -s -b /tmp/tp-cookies.txt "${BASE}${RESULT_URL}" -o /tmp/tp-result.png
file /tmp/tp-result.png
/home/z/.venv/bin/python3 - <<'PYEOF'
import cv2
im = cv2.imread('/tmp/tp-result.png')
assert im is not None and im.shape[0] > 100, "invalid result image"
print(f"RESULT OK: {im.shape}")
PYEOF
echo "E2E PASS"
