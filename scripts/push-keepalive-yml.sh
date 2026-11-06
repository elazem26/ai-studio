#!/bin/bash
# رفع ملف واحد لGitHub: keep-alive.yml بعد تعديل خطوة الإنقاذ
set -e
export GH_TOKEN="${GH_TOKEN:-$(cat /home/z/my-project/data/.gh-token 2>/dev/null | head -1)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO=elazem26/ai-studio
P=.github/workflows/keep-alive.yml
sha=$(gh api "repos/$REPO/contents/$P" --jq .sha 2>/dev/null)
printf '{"message":"fix: rescue pulls latest repo code into the Codespace before boot","branch":"main","sha":"%s","content":"%s"}' \
  "$sha" "$(base64 -w0 /home/z/my-project/$P)" \
  | gh api -X PUT "repos/$REPO/contents/$P" --input - --jq '.content.sha' >/dev/null
echo "pushed: $P"
git hash-object /home/z/my-project/$P
gh api "repos/$REPO/contents/$P" --jq .sha
