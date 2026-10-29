#!/usr/bin/env bash
# ============================================================
# AI Studio v5.5.0 — One-Click Launcher (macOS / Linux)
# Double-click (macOS .command) or run:  bash start-ai-studio.sh
# Installs everything automatically and opens the browser.
# ============================================================
set -e
cd "$(dirname "$0")"

echo ""
echo " =============================================="
echo "   AI Studio v5.5.0  -  One-Click Launcher"
echo " =============================================="
echo ""

# ---------- [1/4] Runtime ----------
RT=""
if command -v bun >/dev/null 2>&1; then RT="bun";
elif command -v node >/dev/null 2>&1; then RT="node";
else
  echo " [1/4] Installing Bun runtime (one time, ~30s)..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  RT="bun"
fi
echo " [1/4] Runtime found: $RT"

# ---------- [2/4] Dependencies ----------
if [ -d node_modules/next ]; then
  echo " [2/4] Dependencies already installed - OK"
else
  echo " [2/4] Installing dependencies - first run only, 2-5 minutes..."
  if [ "$RT" = "bun" ]; then bun install; else npm install --no-audit --no-fund; fi
fi

# ---------- [3/4] Database ----------
if [ -f db/custom.db ]; then
  echo " [3/4] Database found - OK"
else
  echo " [3/4] Preparing database..."
  mkdir -p db
  if [ "$RT" = "bun" ]; then bunx prisma generate >/dev/null 2>&1 || true; bunx prisma db push --accept-data-loss;
  else npx prisma generate >/dev/null 2>&1 || true; npx prisma db push --accept-data-loss; fi
fi

# ---------- [4/4] Start server + open browser ----------
echo " [4/4] Starting AI Studio server..."
nohup npx next dev -p 3000 > server.log 2>&1 &

echo "     waiting for the server to be ready..."
READY=0
for i in $(seq 1 60); do
  sleep 3
  if curl -s -o /dev/null --max-time 3 http://localhost:3000; then READY=1; break; fi
done

if [ "$READY" = "1" ]; then
  ( xdg-open http://localhost:3000 >/dev/null 2>&1 || open http://localhost:3000 >/dev/null 2>&1 ) || true
  echo ""
  echo " =============================================="
  echo "   AI Studio is RUNNING in your browser now:"
  echo "   http://localhost:3000"
  echo ""
  echo "   Keep this window open while using the app."
  echo "   Press Ctrl+C here to STOP the app."
  echo " =============================================="
else
  echo " ERROR: server did not start within 3 minutes. Open server.log for details."
  exit 1
fi
