#!/bin/bash
# Preview watchdog — restarts the AI Studio production server if port 3000
# stops responding. Keeps the preview alive across OOM kills within a session.
# (Processes do not survive sandbox recycling; the session bootstrap or a
#  human must start this once per session: setsid nohup bash scripts/watchdog.sh &)

cd /home/z/my-project

is_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null | grep -q 200; }

start_server() {
  echo "[watchdog $(date +%H:%M:%S)] starting production server…"
  # free the port if a zombie holds it
  fuser -k 3000/tcp 2>/dev/null
  sleep 1
  setsid nohup bun .next/standalone/server.js >> server.log 2>&1 < /dev/null &
  sleep 8
}

echo "[watchdog] started, pid $$"
while true; do
  if ! is_up; then
    echo "[watchdog $(date +%H:%M:%S)] server DOWN — restarting"
    start_server
    if is_up; then echo "[watchdog $(date +%H:%M:%S)] server UP ✓"; fi
  fi
  sleep 20
done
