#!/bin/bash
# e2e-agent-stages.sh — E2E proof: login → upload ×2 → agent-transplant → verify 5 stages
set -u
BASE="${1:-http://localhost:3000}"
cd /home/z/my-project

echo "[1/5] login..."
curl -s -c /tmp/ag-c.txt -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"mohamed","password":"1970"}' -o /tmp/ag-login.json -w "  login HTTP %{http_code}\n"

echo "[2/5] upload source + reference..."
UP1=$(curl -s -b /tmp/ag-c.txt -X POST "$BASE/api/images/upload" -F "file=@scripts/studio-multi-ref.png")
UP2=$(curl -s -b /tmp/ag-c.txt -X POST "$BASE/api/images/upload" -F "file=@scripts/face-multi-ref.png")
SRC=$(echo "$UP1" | /home/z/.venv/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
REF=$(echo "$UP2" | /home/z/.venv/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('path',''))")
echo "  SRC=$SRC"
echo "  REF=$REF"
[ -z "$SRC" ] || [ -z "$REF" ] && { echo "UPLOAD FAILED"; exit 1; }

echo "[3/5] agent-transplant: انقل الرأس ..."
printf '{"sourcePath":"%s","refPath":"%s","command":"\xd8\xa7\xd9\x86\xd9\x82\xd9\x84 \xd8\xa7\xd9\x84\xd8\xb1\xd8\xa3\xd8\xb3"}' "$SRC" "$REF" > /tmp/ag-req.json
curl -s -b /tmp/ag-c.txt -X POST "$BASE/api/images/agent-transplant" \
  -H "Content-Type: application/json" --data-binary @/tmp/ag-req.json \
  -o /tmp/ag-res.json -w "  agent HTTP %{http_code}\n"

echo "[4/5] verify stages..."
/home/z/.venv/bin/python3 - <<'PYEOF'
import json
d = json.load(open('/tmp/ag-res.json'))
if not d.get('url'):
    print('FAIL — no url:', json.dumps(d, ensure_ascii=False)[:300]); raise SystemExit(1)
ss = d.get('stages', [])
print(f"  url: {d['url']} | part: {d.get('part')} | dims: {d.get('width')}x{d.get('height')}")
print(f"  stages: {len(ss)}")
ids = [s.get('id') for s in ss]
assert ids == ['reading', 'analysis', 'thinking', 'understanding', 'execution'], f"BAD IDS: {ids}"
for s in ss:
    assert s.get('title') and isinstance(s.get('ms'), int) and s.get('summary') and s.get('items'), f"INCOMPLETE STAGE: {s}"
    print(f"   - {s['title']} ({s['ms']}ms, {len(s['items'])} بنود): {s['summary']}")
print("STAGES_OK")
PYEOF
[ $? -ne 0 ] && exit 1

echo "[5/5] verify result image bytes..."
/home/z/.venv/bin/python3 - <<'PYEOF'
import json, urllib.request
d = json.load(open('/tmp/ag-res.json'))
img = urllib.request.urlopen("http://localhost:3000" + d['url'], timeout=30).read()
assert len(img) > 5000 and img[:8] == b'\x89PNG\r\n\x1a\n', f"BAD IMAGE {len(img)}"
print(f"  result PNG OK — {len(img)//1024}KB")
print("E2E PASS")
PYEOF
