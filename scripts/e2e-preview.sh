#!/bin/bash
# ============================================================
# e2e-preview.sh — proves المعاينة (preview) works end-to-end:
#   boot server → login → upload image → GET the returned URL
#   (exactly what the UI preview shows) → face detect (boxes)
# ============================================================
set -u
P=/home/z/my-project
cd "$P"

echo "[1/6] regression guard..."
bash scripts/verify-canonical.sh

echo "[2/6] boot standalone server..."
cd .next/standalone
NODE_ENV=production nohup bun server.js > "$P/server.log" 2>&1 &
SPID=$!
cd "$P"
for i in $(seq 1 30); do curl -s -o /dev/null -m 2 http://localhost:3000/ && break; sleep 1; done
curl -s -o /dev/null -m 3 http://localhost:3000/ || { echo "FATAL: server not ready"; tail -15 server.log; exit 1; }
echo "server ready"

echo "[3/6] login..."
CODE=$(curl -s -c /tmp/cookies.txt -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"mohamed","password":"1970"}')
echo "login HTTP $CODE"; [ "$CODE" = "200" ] || { echo "FATAL: login failed"; kill $SPID; exit 1; }

echo "[4/6] upload (the call whose 404 broke المعاينة 3 times)..."
cp -f /home/z/.venv/lib/python3.12/site-packages/insightface/data/images/t1.jpg /tmp/face-test.jpg
UP=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/upload -F "file=@/tmp/face-test.jpg" -w "\nHTTP:%{http_code}")
HTTP=$(echo "$UP" | rg -o "HTTP:[0-9]+" | cut -d: -f2)
BODY=$(echo "$UP" | rg -v "HTTP:")
echo "upload HTTP $HTTP"
[ "$HTTP" = "200" ] || { echo "FATAL: upload failed: $BODY"; kill $SPID; exit 1; }
URL=$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
echo "preview url: $URL"

echo "[5/6] GET the preview URL (what the UI renders)..."
PCODE=$(curl -s -b /tmp/cookies.txt -o /tmp/preview.jpg -w "%{http_code}" "http://localhost:3000$URL")
SZ=$(stat -c%s /tmp/preview.jpg 2>/dev/null || echo 0)
TYPE=$(file -b /tmp/preview.jpg | cut -c1-40)
echo "preview HTTP $PCODE, $SZ bytes, $TYPE"
[ "$PCODE" = "200" ] && [ "$SZ" -gt 10000 ] || { echo "FATAL: preview broken"; kill $SPID; exit 1; }

echo "[6/6] numbered-person detection still fine..."
DET=$(curl -s -m 90 -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/face-detect \
  -H "Content-Type: application/json" \
  -d "{\"imagePath\":\"$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")\"}")
echo "$DET" | python3 -c "
import sys, json
d = json.load(sys.stdin)
n = len(d.get('faces', []))
print('faces detected:', n)
assert n > 0, 'no faces detected'
" || { kill $SPID; exit 1; }

kill $SPID 2>/dev/null
echo "E2E PREVIEW: ALL PASSED ✓"
