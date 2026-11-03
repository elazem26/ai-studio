#!/bin/bash
# رفع ملفات ميزة التحديد والنقل إلى GitHub عبر Contents API
export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO="elazem26/ai-studio"
MSG="تحديد المناطق بالنص العربي + محرر الماوس + نقل مخصص بحارس الشعر + ضبط ذاكرة onnx"

FILES=(
  "mini-services/face-swap-pro/regions.py"
  "mini-services/face-swap-pro/server.py"
  "src/app/api/images/part-transplant/select/route.ts"
  "src/app/api/images/part-transplant/route.ts"
  "src/components/transplant/mask-editor.tsx"
  "src/components/transplant/transplant-panel.tsx"
)

for f in "${FILES[@]}"; do
  B64=$(base64 -w0 "$f")
  # sha للملف الموجود (إن وجد) لتحديثه
  SHA=$(gh api "repos/$REPO/contents/$f" --jq '.sha' 2>/dev/null)
  if [ -n "$SHA" ]; then
    BODY=$(jq -n --arg m "$MSG" --arg b "$B64" --arg s "$SHA" '{message:$m, content:$b, sha:$s}')
  else
    BODY=$(jq -n --arg m "$MSG" --arg b "$B64" '{message:$m, content:$b}')
  fi
  if echo "$BODY" | gh api -X PUT "repos/$REPO/contents/$f" --input - --jq '.commit.sha' > /tmp/push_sha.txt 2>/tmp/push_err.txt; then
    echo "OK  $f ($(cat /tmp/push_sha.txt | head -c 8))"
  else
    echo "ERR $f : $(head -c 150 /tmp/push_err.txt)"
  fi
done
