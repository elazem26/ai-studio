#!/bin/bash
# Push zoom + quality-label files to GitHub via Contents API.
set -e
export GH_TOKEN=$(rg -o "GH_TOKEN='[^']+'" /home/z/my-project/scripts/keepalive-cron.sh | sed "s/GH_TOKEN='//;s/'//")
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO=elazem26/ai-studio
BRANCH=main
cd /home/z/my-project

FILES=(
  src/components/face-swap/face-swap-panel.tsx
  src/components/modals/zoom-modal.tsx
  src/components/shared/enhance-quality-buttons.tsx
  src/components/studio/studio-header.tsx
)

for f in "${FILES[@]}"; do
  if rg -q "ghp_" "$f" 2>/dev/null; then echo "SKIP(secret) $f"; continue; fi
  b64=$(base64 -w0 "$f")
  existing_sha=$(gh api "repos/$REPO/contents/$f?ref=$BRANCH" --jq .sha 2>/dev/null || echo "")
  msg="تبديل الوجوه: زوم حقيقي 1%-5000% بالأزرار والعجلة على المصدر/المرجع/النتيجة + أشرطة جودة HD/FullHD/2K/4K/ULTRA + إصلاح تغطية التبويبات + توسيع نافذة الزوم المشتركة"
  echo "$b64" | /home/z/.venv/bin/python3 -c "
import json, sys
b64 = sys.stdin.read().strip()
msg, sha, br = sys.argv[1], sys.argv[2], sys.argv[3]
p = {'message': msg, 'content': b64, 'branch': br}
if sha: p['sha'] = sha
print(json.dumps(p))
" "$msg" "$existing_sha" "$BRANCH" > /tmp/push-payload.json
  if gh api -X PUT "repos/$REPO/contents/$f" --input /tmp/push-payload.json --jq .commit.sha 2>/dev/null; then
    echo "OK  $f"
  else
    echo "FAIL $f"
  fi
done
