#!/usr/bin/env bash
# Devcontainer start — runs on every Codespace start/restart.
# Starts the AI Studio dev server; the forwarded port 3000 opens
# the browser automatically ("onAutoForward": "openBrowser").
cd "$(dirname "$0")/.."
if curl -s -o /dev/null --max-time 2 http://localhost:3000; then
  echo "[AI Studio] already running on :3000"
  exit 0
fi
echo "[AI Studio] starting dev server..."
nohup npx next dev -p 3000 > /tmp/ai-studio-dev.log 2>&1 &
echo "[AI Studio] starting (log: /tmp/ai-studio-dev.log) — browser will open automatically."
