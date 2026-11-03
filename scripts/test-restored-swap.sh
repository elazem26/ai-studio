#!/bin/bash
# Real end-to-end test of the RESTORED (old) regional garment-swap pipeline.
# Uses the same images from the user's earlier tests.
set -e
BASE=http://localhost:3000
SRC=/uploads/49024ed3-e58d-42d3-bdde-9cc2d7f856bb.jpg    # two women (purple + red) — user's actual test image
REF=/uploads/7d4be004-eb4a-4af3-9ba0-e13981829ec3.jpg    # cyan outfit reference — user's actual test image

echo "== 1) start async job =="
RESP=$(curl -s -X POST "$BASE/api/images/garment-swap" \
  -H "Content-Type: application/json" \
  -d "{\"sourcePath\":\"$SRC\",\"garmentPath\":\"$REF\",\"mappings\":[{\"sourceIndex\":1,\"refIndex\":0}],\"async\":true}")
echo "$RESP"
JOB=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('jobId',''))")
if [ -z "$JOB" ]; then echo "NO JOB ID — FAIL"; exit 1; fi

echo "== 2) poll $JOB =="
for i in $(seq 1 60); do
  sleep 3
  J=$(curl -s "$BASE/api/images/garment-swap?jobId=$JOB")
  ST=$(echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
  PC=$(echo "$J" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('percent',''),d.get('stageLabelEn',''))")
  echo "  [$i] status=$ST $PC"
  if [ "$ST" = "done" ] || [ "$ST" = "error" ]; then
    echo "$J" | python3 -m json.tool | head -40
    break
  fi
done
