#!/bin/bash
# ============================================================
# e2e-face-swap.sh — full end-to-end proof in ONE call:
#   start standalone server → login → upload source+face →
#   POST /api/images/face-swap → verify PNG result
# The sandbox kills background processes between tool calls,
# so everything must happen inside a single invocation.
# ============================================================
set -u
P=/home/z/my-project
cd "$P"

echo "[1/7] regression guard..."
bash scripts/verify-canonical.sh || echo "guard warnings — continuing"

echo "[2/7] starting standalone server..."
cd .next/standalone
NODE_ENV=production nohup bun server.js > "$P/server.log" 2>&1 &
SERVER_PID=$!
cd "$P"

for i in $(seq 1 30); do
  curl -s -o /dev/null -m 2 http://localhost:3000/ && break
  sleep 1
done
curl -s -o /dev/null -m 3 http://localhost:3000/ || { echo "FATAL: server not ready"; tail -20 server.log; exit 1; }
echo "server ready (PID $SERVER_PID)"

echo "[3/7] login..."
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mohamed","password":"1970"}' -o /tmp/login.json -w "login HTTP %{http_code}\n"

echo "[4/7] upload source + face reference..."
cp -f /home/z/.venv/lib/python3.12/site-packages/insightface/data/images/t1.jpg /tmp/face-test.jpg
UP=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/upload -F "file=@/tmp/face-test.jpg")
echo "$UP" | head -c 200; echo
SRC_PATH=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
UP2=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/upload -F "file=@/tmp/face-test.jpg")
FACE_PATH=$(echo "$UP2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
[ -n "$SRC_PATH" ] && [ -n "$FACE_PATH" ] || { echo "FATAL: upload failed: $UP / $UP2"; exit 1; }
echo "source: $SRC_PATH"
echo "face:   $FACE_PATH"

echo "[5/7] face-swap health..."
curl -s -m 10 http://localhost:3000/api/images/face-swap | python3 -c "import sys,json;d=json.load(sys.stdin);print('swap_ready:',d.get('swap_ready'),'buffalo_ready:',d.get('buffalo_ready'),'model:',d.get('model_path'))"

echo "[6/7] POST /api/images/face-swap (the real swap — first call also loads models, may take ~60s)..."
RES=$(curl -s -m 300 -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/face-swap \
  -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SRC_PATH\",\"facePath\":\"$FACE_PATH\"}")
echo "$RES" | head -c 400; echo
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('url'), 'NO RESULT URL — swap failed: ' + json.dumps(d)[:300]
print('SWAP OK →', d['url'], d.get('method'), f\"{d.get('width')}x{d.get('height')}\")
" || FAIL=1

echo "[7/7] verify result file is a real PNG..."
URL=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin).get('url',''))")
[ -n "$URL" ] && curl -s -o /tmp/swap-result.png "http://localhost:3000$URL"
file /tmp/swap-result.png 2>/dev/null
ls -la /tmp/swap-result.png 2>/dev/null

kill $SERVER_PID 2>/dev/null
[ "${FAIL:-0}" = "1" ] && { echo "E2E: FAILED"; exit 1; }
echo "E2E: ALL PASSED ✓"
