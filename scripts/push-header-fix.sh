#!/bin/bash
# Push the face-swap tab fix (header overlap) to GitHub via Contents API.
# Root cause: on xl (1280-1535px) screens the admin backup/download row was
# ~620px wide and covered/squeezed the nav tabs — «تبديل الوجوه» could not be
# clicked at all (user: "عملية التبديل لا تعمل"). Fix: collapse that row into
# the ⋯ menu below 2xl and let the nav shrink cleanly (min-w-0).
set -e
export GH_TOKEN=$(rg -o "GH_TOKEN='[^']+'" /home/z/my-project/scripts/keepalive-cron.sh | sed "s/GH_TOKEN='//;s/'//")
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO=elazem26/ai-studio
BRANCH=main
cd /home/z/my-project

FILES=(
  src/components/studio/studio-header.tsx
)

for f in "${FILES[@]}"; do
  if rg -q "ghp_" "$f" 2>/dev/null; then echo "SKIP(secret) $f"; continue; fi
  b64=$(base64 -w0 "$f")
  existing_sha=$(gh api "repos/$REPO/contents/$f?ref=$BRANCH" --jq .sha 2>/dev/null || echo "")
  msg="إصلاح تبويب تبديل الوجوه: صف أدوات النظام كان يغطي التبويبات على شاشات xl — تقليصه لقائمة ⋯ حتى 2xl + min-w-0 للتنقل"
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
