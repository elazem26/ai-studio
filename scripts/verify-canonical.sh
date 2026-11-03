#!/bin/bash
# ============================================================
# verify-canonical.sh — REGRESSION GUARD (owner request 2026-11-01)
#
# "كل جلسة جديدة كانت تكسر ميزات" — root causes found so far:
#   1. src/app/api/images/upload/route.ts DELETED by old download-v3
#      packaging (created the dir EMPTY) → every upload 404 →
#      "المعاينة لا تعمل". Happened 3+ times.
#   2. mini-services/face-swap-pro/models/*.onnx excluded from GitHub
#      (by design) → face swap dead in every fresh session →
#      "تبديل الوجه لا يعمل". (Self-healed by server.py +
#      scripts/download-models.sh.)
#   3. Stale code copies inside .next/standalone shadowed the real
#      source (fixed: mini-service.ts skips .next-internal paths).
#
# This guard makes the CURRENT tree canonical: any critical file
# that went missing is restored from git HEAD automatically.
# Run: at server start, before push, and in CI-like checks.
# ============================================================
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CRITICAL=(
  "src/app/api/images/upload/route.ts"
  "src/app/api/images/face-swap/route.ts"
  "src/app/api/images/garment-swap/route.ts"
  "src/app/api/images/face-detect/route.ts"
  "src/app/api/video/face-swap/route.ts"
  "src/app/api/download-v3/route.ts"
  "src/app/api/auth/login/route.ts"
  "mini-services/face-swap-pro/server.py"
  "scripts/face-swap-guardian.py"
  "src/lib/mini-service.ts"
  "src/lib/security/resolve-file-path.ts"
  "src/lib/processing-lock.ts"
  "src/hooks/use-toast.ts"
  "scripts/download-models.sh"
  "package.json"
  "next.config.ts"
  "prisma/schema.prisma"
)

MISSING=0
RESTORED=0
for f in "${CRITICAL[@]}"; do
  if [ ! -f "$f" ]; then
    MISSING=$((MISSING + 1))
    if git cat-file -e "HEAD:$f" 2>/dev/null; then
      git checkout "HEAD" -- "$f" && \
        echo "[guard] RESTORED from HEAD: $f" && RESTORED=$((RESTORED + 1))
    else
      # The deletion itself may already be COMMITTED (auto-commit propagates
      # on-disk deletions — happened with e57e7f7). Find the LAST commit that
      # still CONTAINED the file — note `git log -1 -- path` can return the
      # DELETION commit itself, so walk the touching commits newest-first
      # and pick the first one that actually has the file.
      LAST=""
      for c in $(git rev-list --all -30 -- "$f" 2>/dev/null); do
        if git cat-file -e "$c:$f" 2>/dev/null; then LAST="$c"; break; fi
      done
      if [ -n "$LAST" ]; then
        git checkout "$LAST" -- "$f" && \
          echo "[guard] RESTORED from history ($LAST): $f" && RESTORED=$((RESTORED + 1))
      else
        echo "[guard] FATAL: missing and NOT in any commit: $f"
      fi
    fi
  fi
done

if [ "$RESTORED" -gt 0 ]; then
  echo "[guard] $RESTORED file(s) restored — rebuild required: bun run build"
fi

# Stale-copy check: a server.py inside .next shadows the canonical one.
if [ -e ".next/standalone/mini-services" ]; then
  rm -rf ".next/standalone/mini-services"
  echo "[guard] removed stale .next/standalone/mini-services copy"
fi

if [ "$MISSING" -eq 0 ]; then
  echo "[guard] OK — all ${#CRITICAL[@]} critical files present"
  exit 0
fi
exit 1
