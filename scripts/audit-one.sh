#!/bin/bash
P="$1"
agent-browser open "http://localhost:3000/$P" > /dev/null 2>&1
sleep 2.5
INJ=$(cat /home/z/my-project/scripts/ab-inject.js)
agent-browser eval "$INJ" > /dev/null
echo "=== /$P ==="
agent-browser eval "JSON.stringify(__audit())"
