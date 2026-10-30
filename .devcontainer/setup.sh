#!/usr/bin/env bash
# Devcontainer setup — runs ONCE when the Codespace is created.
# Installs deps + prepares the database (db/custom.db ships in the repo).
set -e
cd "$(dirname "$0")/.."
# [0] serve a friendly loading page on :3000 IMMEDIATELY so the
# auto-opened browser tab never shows HTTP 502 during install.
# start-server.sh retires it right before the real app binds.
if ! curl -s -o /dev/null --max-time 2 http://localhost:3000; then
  nohup node .devcontainer/placeholder-server.js >/tmp/ai-studio-placeholder.log 2>&1 &
  echo $! > /tmp/ai-studio-placeholder.pid
fi
# Force an ABSOLUTE db path for THIS environment (repo may live in any dir;
# relative file: paths break in some runtimes). Ships as relative, fixed here.
mkdir -p db
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=file:$(pwd)/db/custom.db|" .env
# runtime data dirs (uploads/results/sessions are git-ignored in the clean
# repo copy — the app expects them to exist; upload route also self-heals)
mkdir -p data/uploads data/results data/sessions data/temp
echo "[AI Studio setup] installing dependencies (2-4 min)..."
npm install --no-audit --no-fund \
  || { echo "[AI Studio setup] npm install failed — retrying once..."; npm install --no-audit --no-fund; }
echo "[AI Studio setup] generating prisma client..."
npx prisma generate
if [ ! -f db/custom.db ]; then
  mkdir -p db
  npx prisma db push --accept-data-loss
fi
# NOTE: no production build here — it added 3-6 min to every FIRST
# creation. start-server.sh runs dev mode immediately (browser opens
# on the app as soon as deps are installed) and pre-compiles the
# landing page via its warm-up loop.
echo "[AI Studio setup] DONE — server starts now, browser opens automatically."
