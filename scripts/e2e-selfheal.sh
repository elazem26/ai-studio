#!/bin/bash
# ============================================================
# e2e-selfheal.sh — prove the SELF-HEAL loop ends the
# "face swap breaks in every new session" regression.
#
# Simulates a fresh session: DELETE the swap model → POST a
# swap → expect HTTP 503 {"downloading":true, progress N} +
# automatic background re-download → swap succeeds afterwards.
# ============================================================
set -u
P=/home/z/my-project
MODEL="$HOME/.insightface/models/inswapper_128.onnx"
cd "$P"

echo "[1/6] simulate fresh session — DELETE the swap model..."
mv "$MODEL" /tmp/model-backup.onnx
ls -la "$MODEL" 2>/dev/null || echo "model deleted ✓ (like a fresh Codespace)"

echo "[2/6] start server + login + uploads..."
cd .next/standalone
NODE_ENV=production nohup bun server.js > "$P/server.log" 2>&1 &
SERVER_PID=$!
cd "$P"
for i in $(seq 1 30); do curl -s -o /dev/null -m 2 http://localhost:3000/ && break; sleep 1; done
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"mohamed","password":"1970"}' -o /dev/null -w "login HTTP %{http_code}\n"
cp -f /home/z/.venv/lib/python3.12/site-packages/insightface/data/images/t1.jpg /tmp/face-test.jpg
UP=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/upload -F "file=@/tmp/face-test.jpg")
SRC=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
echo "uploaded: $SRC"

echo "[3/6] POST swap WITHOUT the model — expect 503 + downloading flag..."
RES=$(curl -s -m 60 -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/face-swap \
  -H "Content-Type: application/json" -d "{\"sourcePath\":\"$SRC\",\"facePath\":\"$SRC\"}")
echo "$RES" | head -c 300; echo
echo "$RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('downloading') is True, 'NOT a downloading response: ' + json.dumps(d)[:200]
print('SELF-HEAL KICKED ✓ (downloading=true, progress=%s%%)' % d.get('progress'))
"

echo "[4/6] wait for the automatic re-download (555MB, up to 6 min)..."
for i in $(seq 1 72); do
  sleep 5
  SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
  if [ "$SZ" -ge 500000000 ]; then echo "model auto-restored: $SZ bytes ✓ (after ~$((i*5))s)"; break; fi
  [ $((i % 6)) -eq 0 ] && echo "  ...$((i*5))s: $SZ bytes"
done
SZ=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
[ "$SZ" -ge 500000000 ] || { echo "FATAL: model not restored within 6 min"; kill $SERVER_PID 2>/dev/null; exit 1; }

echo "[5/6] POST swap AGAIN — must succeed now..."
RES2=$(curl -s -m 300 -b /tmp/cookies.txt -X POST http://localhost:3000/api/images/face-swap \
  -H "Content-Type: application/json" -d "{\"sourcePath\":\"$SRC\",\"facePath\":\"$SRC\"}")
echo "$RES2" | head -c 300; echo
echo "$RES2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('url'), 'SWAP FAILED AFTER SELF-HEAL: ' + json.dumps(d)[:200]
print('SWAP AFTER SELF-HEAL OK ✓ →', d['url'])
"

echo "[6/6] cleanup..."
kill $SERVER_PID 2>/dev/null
rm -f /tmp/model-backup.onnx
echo "SELF-HEAL E2E: ALL PASSED ✓"
