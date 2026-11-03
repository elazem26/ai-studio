#!/bin/bash
# restore-missing.sh — restore every file tracked in 9d786e0 that the hard
# reset wiped from the working tree (runtime files, .env, db, uploads, gh cli).
set -e
cd /home/z/my-project
TOTAL=0
FAIL=0
while IFS= read -r f; do
  mkdir -p "$(dirname "$f")"
  if git checkout 9d786e0 -- "$f" 2>/dev/null; then
    TOTAL=$((TOTAL+1))
  else
    echo "FAIL: $f" >> /tmp/restore-failures.txt
    FAIL=$((FAIL+1))
  fi
done < /tmp/missing-files.txt
echo "restored=$TOTAL failed=$FAIL"
