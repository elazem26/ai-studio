#!/usr/bin/env bash
# codespace-selfheal.sh — REST-API self-heal without gh CLI (recreate after sandbox recycle)
# Start codespace -> wait Available -> publicize port 3000 -> poll public URL.
set -u
# Auto-restore token from git remote if the file was lost by a sandbox recycle
if [ ! -s /home/z/my-project/data/.gh-token ]; then
  git -C /home/z/my-project remote get-url origin 2>/dev/null | sed -E 's|.*x-access-token:([^@]+)@.*|\1|' > /home/z/my-project/data/.gh-token
  chmod 600 /home/z/my-project/data/.gh-token 2>/dev/null
fi
TOKEN=$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)
API="https://api.github.com"
CS="disreputable-wizard-px65r97q6xpfrjg4"
URL="https://disreputable-wizard-px65r97q6xpfrjg4-3000.app.github.dev"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "[1] start codespace"
curl -s -m 60 -o /dev/null -w 'start=%{http_code}\n' -X POST "${H[@]}" "$API/user/codespaces/$CS/start" || echo "start call failed/timed out, continuing"

echo "[2] wait for Available (up to 180s)"
state=""
for i in $(seq 1 12); do
  sleep 15
  state=$(curl -s -m 15 "${H[@]}" "$API/user/codespaces/$CS" | python3 -c "import sys,json;print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  echo "  t=$((i*15))s state=$state"
  [ "$state" = "Available" ] && break
done

echo "[3] publicize port 3000"
for vis in open public; do
  rc=$(curl -s -o /tmp/port.json -w '%{http_code}' -X PUT "${H[@]}" "$API/user/codespaces/$CS/ports/3000" -d "{\"visibility\":\"$vis\"}")
  echo "  visibility=$vis http=$rc"
  [ "$rc" = "200" ] && break
done

echo "[4] poll public URL (up to 240s, every 20s)"
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$URL/" 2>/dev/null || echo 000)
  echo "  t=$((i*20))s http=$code"
  case "$code" in 200|302|307|401) echo "RECOVERED"; exit 0;; esac
  sleep 20
done

echo "[5] fallback: dispatch keep-alive workflow"
curl -s -o /dev/null -w 'dispatch=%{http_code}\n' -X POST "${H[@]}" \
  "$API/repos/elazem26/ai-studio/actions/workflows/keep-alive.yml/dispatches" \
  -d '{"ref":"main"}'
exit 1
