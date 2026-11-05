#!/bin/bash
# رفع ملفين محدثين لGitHub عبر Contents API (جلب sha أولاً ثم PUT)
set -e
export GH_TOKEN="${GH_TOKEN:-$(cat /home/z/my-project/data/.gh-token 2>/dev/null | head -1)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
REPO=elazem26/ai-studio
BRANCH=main

push_file () {
  local local_path="$1" repo_path="$2" msg="$3"
  local sha b64
  sha=$(gh api "repos/$REPO/contents/$repo_path?ref=$BRANCH" --jq .sha 2>/dev/null || echo "")
  b64=$(base64 -w0 "$local_path")
  if [ -n "$sha" ]; then
    printf '{"message":"%s","branch":"%s","sha":"%s","content":"%s"}' \
      "$msg" "$BRANCH" "$sha" "$b64" \
      | gh api -X PUT "repos/$REPO/contents/$repo_path" --input - \
        --jq '.content.sha' >/dev/null
  else
    printf '{"message":"%s","branch":"%s","content":"%s"}' \
      "$msg" "$BRANCH" "$b64" \
      | gh api -X PUT "repos/$REPO/contents/$repo_path" --input - \
        --jq '.content.sha' >/dev/null
  fi
  echo "pushed: $repo_path"
}

push_file /home/z/my-project/mini-services/face-swap-pro/server.py \
  mini-services/face-swap-pro/server.py \
  "fix: unified anatomical hair mask for custom hair transplant (no more ghost overlay)"

push_file /home/z/my-project/scripts/start-production.sh \
  scripts/start-production.sh \
  "feat: code sync on boot — Codespace always serves the canonical repo code"

echo "--- verify fingerprints ---"
git hash-object /home/z/my-project/mini-services/face-swap-pro/server.py
gh api "repos/$REPO/contents/mini-services/face-swap-pro/server.py" --jq .sha
git hash-object /home/z/my-project/scripts/start-production.sh
gh api "repos/$REPO/contents/scripts/start-production.sh" --jq .sha
