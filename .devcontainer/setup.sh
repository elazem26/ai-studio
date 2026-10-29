#!/usr/bin/env bash
# Devcontainer setup — runs ONCE when the Codespace is created.
# Installs deps + prepares the database (db/custom.db ships in the repo).
set -e
cd "$(dirname "$0")/.."
echo "[AI Studio setup] installing dependencies (2-4 min)..."
npm install --no-audit --no-fund
echo "[AI Studio setup] generating prisma client..."
npx prisma generate
if [ ! -f db/custom.db ]; then
  mkdir -p db
  npx prisma db push --accept-data-loss
fi
echo "[AI Studio setup] DONE."
