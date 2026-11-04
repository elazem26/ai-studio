#!/bin/bash
# Production startup used by `bun run dev` (the platform session bootstrap).
# Why: `next dev` (Turbopack) balloons to 1.5GB+ on this 4GB box and the kernel
# OOM-killer shoots it mid-request (preview dies). The standalone production
# server runs at ~165MB with identical behavior. Build is reused when fresh.
#
# SELF-HEALING BOOT (2026-11-02): the platform snapshot/restore can hand us a
# tree with critical files missing (upload route deleted 3+ times → كل جلسة
# جديدة "المعاينة لا تعمل"). Order matters:
#   1. guard  — restore critical source files from git BEFORE anything
#   2. build  — always verify the BUILD actually contains the critical routes
#               (a stale/poisoned build must be rebuilt, not trusted)
#   3. serve  — only start when the build is proven complete

cd "$(dirname "$0")/.."

# bun may be missing from non-interactive SSH PATH (workflow rescues) —
# resolve it once from the standard install location as a fallback.
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || for c in "$HOME/.bun/bin/bun" /usr/local/bin/bun /usr/bin/bun; do
  [ -x "$c" ] && BUN="$c" && break
done
[ -n "$BUN" ] || BUN=bun

# ---- 1. REGRESSION GUARD (restores critical files from git) ----
bash scripts/verify-canonical.sh || true

# ---- 1b. CODE SYNC (serve the canonical GitHub code, not a stale checkout) ----
# The Codespace checkout can lag far behind GitHub — that is how the public
# link kept serving the OLD pasted-transplant build while the repo already
# had the seamless v3 pipeline. Every boot now syncs first:
#   • inside Codespaces → fetch + reset --hard to origin/<branch> (the
#     checkout is a pure consumer, nothing valuable to lose)
#   • local builds → a safe fast-forward pull only
# then restart any stale python face service so it serves the fresh code
# (the Next instrumentation respawns it right after boot).
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
   && git remote get-url origin >/dev/null 2>&1; then
  if [ -n "${CODESPACES:-}" ] || [ "${PWD#*/workspaces/}" != "$PWD" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
    git fetch origin "$BRANCH" >/dev/null 2>&1 || true
    git reset --hard "origin/$BRANCH" >/dev/null 2>&1 || true
  else
    git pull --ff-only >/dev/null 2>&1 || true
  fi
  pkill -f "face-swap-pro/server.py" >/dev/null 2>&1 || true
fi

STALE=0
if [ ! -f .next/standalone/server.js ]; then
  STALE=1
# rebuild if any source file is newer than the last build
elif [ -n "$(find src public package.json next.config.ts -newer .next/standalone/server.js -type f 2>/dev/null | head -1)" ]; then
  STALE=1
fi

# ---- 2. BUILD-INTEGRITY CHECK: the build itself must contain the routes ----
# A build made while route.ts was missing silently lacks the compiled handler
# (404 "Server action not found" on every upload). Never trust a build that
# doesn't have all critical compiled routes on disk.
for compiled in \
  .next/standalone/.next/server/app/api/images/upload/route.js \
  .next/standalone/.next/server/app/api/images/face-swap/route.js \
  .next/standalone/.next/server/app/api/auth/login/route.js; do
  if [ ! -f "$compiled" ]; then
    echo "[start-production] build missing $compiled — forcing rebuild"
    STALE=1
    break
  fi
done

if [ "$STALE" = "1" ]; then
  echo "[start-production] building production bundle…"
  "$BUN" run build || exit 1
fi

# ---- 3. standalone needs static assets copied next to server.js ----
[ -d .next/standalone/.next/static ] || cp -r .next/static .next/standalone/.next/static
[ -d .next/standalone/public ] || cp -r public .next/standalone/public

echo "[start-production] launching standalone server on :3000"
exec "$BUN" .next/standalone/server.js
