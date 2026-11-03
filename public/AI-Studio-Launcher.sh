#!/bin/bash
# AI Studio — Desktop Launcher (Linux/Mac)
# Place this file on your Desktop and make it executable: chmod +x AI-Studio-Launcher.sh
# Double-click to start AI Studio + open browser

cd "$(dirname "$0")"

# Check if already running
if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo "AI Studio already running — opening browser..."
    xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null
    exit 0
fi

# Start face-swap service
cd mini-services/face-swap-pro
python3 server.py &
FACE_PID=$!
cd ../..
sleep 3

# Start Next.js
npm run dev &
NEXT_PID=$!

# Wait for Next.js to be ready, then open browser
for i in $(seq 1 15); do
    sleep 1
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null
        break
    fi
done

# Wait for Ctrl+C
trap "kill $FACE_PID $NEXT_PID 2>/dev/null; exit 0" INT TERM
wait
