#!/usr/bin/env bash
# End-to-end test of the async garment-swap job API:
# 1) POST async -> jobId must return in <3s
# 2) poll GET?jobId -> running stages with percent
# 3) final done -> result URL
set -u
BASE="http://localhost:3000/api/images/garment-swap"
SRC="/uploads/d2cd7d2d-e7d1-4eb6-af0f-4b16e26791b6.jpg"
REF="/uploads/13de2e51-927f-4faf-ac60-600e8819ccbb.jpg"

T0=$(date +%s%3N)
POST_RES=$(curl -s -X POST "$BASE" -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SRC\",\"garmentPath\":\"$REF\",\"mappings\":[{\"sourceIndex\":0,\"refIndex\":0}],\"async\":true}" \
  --max-time 20)
T1=$(date +%s%3N)
echo "POST took $((T1-T0)) ms -> $POST_RES"

JOB=$(echo "$POST_RES" | python3 -c "import sys,json;print(json.load(sys.stdin).get('jobId',''))")
if [ -z "$JOB" ]; then echo "NO JOB ID — FAIL"; exit 1; fi

for i in $(seq 1 100); do
  sleep 3
  J=$(curl -s "$BASE?jobId=$JOB" --max-time 15)
  STATUS=$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status','?'),d.get('percent',''),d.get('stageLabelAr',''))" 2>/dev/null)
  echo "poll $i: $STATUS"
  S=$(echo "$STATUS" | cut -d' ' -f1)
  if [ "$S" = "done" ] || [ "$S" = "error" ]; then
    echo "FINAL: $J"
    exit $([ "$S" = "done" ] && echo 0 || echo 1)
  fi
done
echo "TIMEOUT"
exit 2
