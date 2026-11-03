#!/bin/bash
# رفع ملفات ميزة المربعات المرقمة إلى GitHub عبر Contents API
set -e
export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO="elazem26/ai-studio"
BRANCH="main"

push_file() {
  local file="$1" msg="$2"
  local b64 sha
  b64=$(base64 -w0 "$file")
  sha=$(gh api "repos/$REPO/contents/$file?ref=$BRANCH" --jq .sha 2>/dev/null || echo "")
  if [ -n "$sha" ]; then
    gh api -X PUT "repos/$REPO/contents/$file" \
      -f message="$msg" -f content="$b64" -f sha="$sha" -f branch="$BRANCH" --jq .commit.sha >/dev/null && echo "UPDATED  $file"
  else
    gh api -X PUT "repos/$REPO/contents/$file" \
      -f message="$msg" -f content="$b64" -f branch="$BRANCH" --jq .commit.sha >/dev/null && echo "CREATED  $file"
  fi
}

MSG="مربعات مرقمة على المصدر والمرجع لاختيار الشخص + دعم عدة مراجع"
push_file "src/components/transplant/face-boxes.tsx" "$MSG"
push_file "src/components/transplant/transplant-panel.tsx" "$MSG"
push_file "src/app/api/images/part-transplant/select/route.ts" "$MSG"
echo "DONE"
