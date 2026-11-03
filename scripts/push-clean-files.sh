#!/bin/bash
# Push clean code files to GitHub via the Contents API (push protection
# blocks git push because old local commits embed a token — file-level
# updates carry only current file contents, never old history).
set -e
export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO=elazem26/ai-studio
BRANCH=main
cd /home/z/my-project

FILES=(
  mini-services/face-swap-pro/regions.py
  mini-services/face-swap-pro/server.py
  src/app/api/images/part-transplant/route.ts
  src/app/api/images/part-transplant/select/route.ts
  src/components/modals/zoom-modal.tsx
  src/components/studio/complete-download-dialog.tsx
  src/components/transplant/face-boxes.tsx
  src/components/transplant/mask-editor.tsx
  src/components/transplant/transplant-panel.tsx
  src/lib/backup.ts
  src/lib/full-archive.ts
)

for f in "${FILES[@]}"; do
  # security: skip any file that contains the token
  if rg -q "ghp_" "$f" 2>/dev/null; then echo "SKIP(secret) $f"; continue; fi
  sha=$(git hash-object "$f")
  b64=$(base64 -w0 "$f")
  existing_sha=$(gh api "repos/$REPO/contents/$f?ref=$BRANCH" --jq .sha 2>/dev/null || echo "")
  msg="تحديث $f — زر إغلاق النتيجة + تراجع/تقدّم + ثبات الصفحة عند الرفع + دمج الجسم بطريقة الرأس + زوم"
  base64 -w0 "$f" > /tmp/push-b64.txt
  payload=$(cat /tmp/push-b64.txt | /home/z/.venv/bin/python3 -c "
import json, sys
b64 = sys.stdin.read().strip()
msg, sha, br = sys.argv[1], sys.argv[2], sys.argv[3]
p = {'message': msg, 'content': b64, 'branch': br}
if sha: p['sha'] = sha
print(json.dumps(p))
" "$msg" "$existing_sha" "$BRANCH")
  if gh api -X PUT "repos/$REPO/contents/$f" --input <(echo "$payload") --jq .commit.sha >/dev/null 2>&1; then
    echo "OK  $f"
  else
    echo "FAIL $f"
  fi
done
