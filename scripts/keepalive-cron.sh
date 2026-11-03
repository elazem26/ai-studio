#!/usr/bin/env bash
# keepalive-cron.sh — called by the platform scheduler every 15 minutes.
# 1. Ping the public URL; if it answers (200/302/307/401) also ping
#    ensure-services to reset the Codespace idle timer.
# 2. If dead (404/502/000), dispatch the keep-alive workflow on GitHub
#    (it starts the Codespace, re-publicizes the port and SSH-rescues the app).
export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH

URL="https://disreputable-wizard-px65r97q6xpfrjg4-3000.app.github.dev"
LOG=/home/z/my-project/data/keepalive-cron.log

code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "$URL/" 2>/dev/null || echo 000)
echo "$(date -Is) probe=$code" >> "$LOG"

case "$code" in
  200|302|307|401)
    curl -s -m 60 "$URL/api/system/ensure-services" >/dev/null 2>&1 || true
    echo "$(date -Is) ensure-services pinged" >> "$LOG"
    ;;
  *)
    echo "$(date -Is) DOWN -> dispatching keep-alive workflow" >> "$LOG"
    gh workflow run keep-alive.yml -R elazem26/ai-studio --ref main >/dev/null 2>&1 || true
    ;;
esac
