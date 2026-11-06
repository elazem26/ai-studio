#!/bin/bash
# رفع التزامات جلسة العمل إلى GitHub — يقرأ التوكن وقت التشغيل من data/.gh-token
set -e
cd /home/z/my-project

GH_TOKEN="${GH_TOKEN:-$(cat /home/z/my-project/data/.gh-token 2>/dev/null | head -1)}"
if [ -z "$GH_TOKEN" ]; then echo "FATAL: no token in data/.gh-token"; exit 1; fi

GH=/home/z/my-project/scripts/gh-cli/bin/gh
[ -x "$GH" ] || GH=$(command -v gh || true)
if [ -n "$GH" ]; then
  export GH_TOKEN
  LOGIN=$("$GH" api user --jq .login 2>/dev/null || true)
  echo "token-ok login=$LOGIN"
fi

# حدّث الـ remote بالتوكن الصالح (دون طباعته)
git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/elazem26/ai-studio.git"

echo "--- fetch & sync state ---"
git fetch origin main 2>&1 | tail -1 || true
git rev-list --left-right --count origin/main...main || true

echo "--- push ---"
GIT_TERMINAL_PROMPT=0 git push origin main 2>&1 | sed -E 's#(x-access-token:)[^@]+@#\1***@#g'
echo "--- final sync state ---"
git rev-list --left-right --count origin/main...main
git log --oneline -1 origin/main
