#!/bin/bash
# ============================================================
# gh-run-chain.sh <TOKEN> [REPO_NAME]
#
# Locked wrapper for the always-latest GitHub backup chain:
#   1. acquire exclusive lock (.gh-lock) — one chain at a time
#   2. truncate .gh-push.log (fresh log per run, no stale markers)
#   3. gh-prepare-staging.sh  (incremental: commit ONLY the diff)
#   4. gh-push-full.sh        (push to PRIVATE repo; later pushes
#                              upload only changed files)
# Exit codes: 0 ok · 3 busy · other = chain failure
# ============================================================
P=/home/z/my-project
TOKEN="${1:-}"
REPO="${2:-ai-studio-full-backup}"

if [ -z "$TOKEN" ]; then
  echo "FATAL: token required"
  exit 1
fi

# ---- memory guard: backup chains are memory-hungry (git over ~900MB tree);
# on this 4GB box running one next to the face-swap service triggered OOM
# kills and container restarts. Refuse to run when RAM is tight. ----
AVAIL=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "${AVAIL:-0}" -lt 400 ]; then
  echo "FATAL: الذاكرة المتاحة ${AVAIL}MB أقل من الحد الآمن (400MB — نسخة نظيفة صغيرة) — أُلغيت عملية النسخ لحماية استقرار النظام. أعد المحاولة بعد قليل."
  exit 1
fi

exec 9>/home/z/.gh-lock
if ! flock -n 9; then
  echo "BUSY: another GitHub chain is already running"
  exit 3
fi

: > /home/z/.gh-push.log
echo "=== GitHub push started $(date) ==="
cd "$P"
SKIP_BUNDLE=0 bash scripts/gh-prepare-staging.sh && bash scripts/gh-push-full.sh "$TOKEN" "$REPO"
