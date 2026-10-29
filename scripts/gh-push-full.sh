#!/bin/bash
# ============================================================
# Push the FULL backup to GitHub (private repo)
# Usage:  bash scripts/gh-push-full.sh <GITHUB_TOKEN> [repo-name]
#
# Pushes .gh-staging (single full-backup commit):
#   code + .env (plaintext keys) + db + data + models (split) + skills
# Also updates .env with GITHUB_TOKEN/GITHUB_BACKUP_REPO so the
# end-session GitHub step works afterwards, and re-commits it.
# ============================================================
set -u
TOKEN="${1:-}"
REPO_NAME="${2:-ai-studio-full-backup}"
S=/home/z/.gh-staging
P=/home/z/my-project
API="https://api.github.com"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

# NOTE: output capture is owned by scripts/gh-run-chain.sh (the wrapper).
# This script must NOT tee/truncate .gh-push.log itself — the old
# `exec > >(tee ...)` here erased the wrapper's header + prepare output.

if [ -z "$TOKEN" ]; then echo "ERROR: token required"; exit 1; fi

echo "[1/6] validate token..."
LOGIN=$(curl -sS "${H[@]}" "$API/user" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login',''))" 2>/dev/null)
if [ -z "$LOGIN" ]; then echo "FATAL: token invalid (401)"; exit 1; fi
echo "login=$LOGIN"

echo "[2/6] sanity: no file >99MB outside .git..."
BIG=$(find "$S" -type f -size +99M -not -path '*/.git/*' | head -3)
if [ -n "$BIG" ]; then echo "FATAL: oversized files would be rejected by GitHub:"; echo "$BIG"; exit 1; fi
echo "OK"

echo "[3/6] create private repo $LOGIN/$REPO_NAME..."
STATUS=$(curl -sS -o /tmp/gh-create.json -w "%{http_code}" "${H[@]}" -X POST "$API/user/repos" \
  -d "{\"name\":\"$REPO_NAME\",\"private\":true,\"description\":\"AI Studio full backup: code + plaintext keys + models + data\",\"has_wiki\":false,\"has_issues\":false}")
if [ "$STATUS" = "201" ]; then
  echo "created (private)"
elif [ "$STATUS" = "422" ]; then
  echo "already exists — using it"
else
  echo "FATAL: create failed HTTP $STATUS: $(head -c 300 /tmp/gh-create.json)"
  echo "HINT: fine-grained PATs cannot create repos. Create the repo manually (Private) then re-run, or use a classic PAT with repo scope."
  exit 1
fi

REPO="$LOGIN/$REPO_NAME"
case "$REPO_NAME" in
  */*) REPO="$REPO_NAME" ;;  # owner/repo given explicitly
  *)   REPO="$LOGIN/$REPO_NAME" ;;
esac

echo "[4/6] update .env with GitHub config (plaintext, per owner request)..."
add_env() {
  grep -q "^$1=" "$P/.env" 2>/dev/null && sed -i "s|^$1=.*|$1=$2|" "$P/.env" || echo "$1=$2" >> "$P/.env"
}
add_env "GITHUB_TOKEN" "$TOKEN"
add_env "GITHUB_BACKUP_REPO" "$REPO"
cp "$P/.env" "$S/.env"
git -C "$S" add .env
git -C "$S" commit -q -m "config: GITHUB_TOKEN + GITHUB_BACKUP_REPO in .env (plaintext, owner request)" || true

echo "[5/6] push..."
if ! git -C "$S" rev-parse --verify origin/main >/dev/null 2>&1; then
  echo "first push to this remote — will force (fresh history)"
  FORCE="--force"
else
  # incremental mode: staging history is authoritative, normal push;
  # fall back to force only if remote diverged unexpectedly.
  FORCE=""
fi
git -C "$S" remote remove origin 2>/dev/null
git -C "$S" remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git -C "$S" config http.postBuffer 524288000
git -C "$S" config http.lowSpeedLimit 1000
git -C "$S" config http.lowSpeedTime 60
if git -C "$S" push -u origin main $FORCE 2>&1 | sed "s|x-access-token:[^@]*@|***@|g"; then
  echo "PUSH OK"
else
  if [ -z "$FORCE" ]; then
    echo "normal push failed — retrying with --force..."
    if git -C "$S" push -u origin main --force 2>&1 | sed "s|x-access-token:[^@]*@|***@|g"; then
      echo "PUSH OK (forced)"
    else
      echo "PUSH FAILED — see log above"; exit 1
    fi
  else
    echo "PUSH FAILED — see log above"; exit 1
  fi
fi

echo "[6/6] verify remote..."
CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${H[@]}" "$API/repos/$REPO/branches/main")
echo "remote main branch HTTP: $CODE"
echo "repo url: https://github.com/$REPO (private)"
echo "ALL-PUSH-DONE"
