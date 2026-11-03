#!/bin/bash
# ============================================================
# repair-and-restore.sh — one-tap project repair (owner request
# 2026-11-02: "زر لتنشيط المشروع واستعادة المحذوف من الهاتف").
#
# Run DETACHED by POST /api/system/repair. Sequence:
#   1. verify-canonical  — restore critical files from git history
#   2. download-models   — restore missing ONNX models (self-heal)
#   3. build integrity   — rebuild if compiled routes are missing/stale
#   4. restart server    — relaunch standalone on :3000
# Progress is appended to data/repair.log; the /repair page polls
# GET /api/system/repair until the server comes back.
# ============================================================
set -u
P="$(cd "$(dirname "$0")/.." && pwd)"
cd "$P"
LOG="$P/data/repair.log"
mkdir -p "$P/data"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

# Repair statistics (data/repair-stats.json) — shown on /repair + health-check.
STATS="$P/data/repair-stats.json"
REPAIR_START=$(date +%s)
write_stats() {
  local result="$1"
  local dur=$(( $(date +%s) - REPAIR_START ))
  python3 - "$STATS" "$result" "$dur" <<'PYEOF'
import json, sys, datetime
path, result, dur = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    s = json.load(open(path))
except Exception:
    s = {"lastRepairAt": None, "totalRepairs": 0, "lastResult": None}
s["lastRepairAt"] = datetime.datetime.now().isoformat(timespec="seconds")
s["lastResult"] = result
s["lastDurationSec"] = dur
s["totalRepairs"] = int(s.get("totalRepairs", 0)) + 1
json.dump(s, open(path, "w"), ensure_ascii=False, indent=1)
PYEOF
}

: > "$LOG"
log "=== بدء الإصلاح الشامل ==="

log "[1/4] استعادة الملفات الحرجة من git..."
bash scripts/verify-canonical.sh >> "$LOG" 2>&1 || log "⚠ بعض الملفات لم تُستعد — راجع السجل"

log "[2/4] فحص النماذج (تحميل تلقائي إن نقصت)..."
if bash scripts/download-models.sh >> "$LOG" 2>&1; then
  log "النماذج جاهزة ✓"
else
  log "⚠ تعذر اكتمال تحميل النماذج الآن — الخدمة تعيد المحاولة لاحقاً تلقائياً"
fi

log "[3/4] فحص سلامة البناء..."
NEED_BUILD=0
if [ ! -f .next/standalone/server.js ]; then
  NEED_BUILD=1
elif [ ! -f .next/standalone/.next/server/app/api/images/upload/route.js ]; then
  NEED_BUILD=1
elif [ -n "$(find src public package.json next.config.ts -newer .next/standalone/server.js -type f 2>/dev/null | head -1)" ]; then
  NEED_BUILD=1
fi

if [ "$NEED_BUILD" = "1" ]; then
  log "إعادة البناء (2-4 دقائق)... من فضلك انتظر"
  rm -rf .next
  if bun run build >> "$LOG" 2>&1; then
    log "البناء اكتمل ✓"
  else
    log "FATAL: فشل البناء — راجع السجل أدناه"
    tail -20 "$P/dev.log" >> "$LOG" 2>/dev/null
    echo "REPAIR-FAILED" >> "$LOG"
    exit 1
  fi
else
  log "البناء سليم — لا حاجة لإعادة البناء ✓"
fi

log "[4/4] إعادة تشغيل السيرفر..."
# Kill any process bound to :3000 EXCEPT ourselves, then relaunch.
for pid in $(ss -tlnp 2>/dev/null | rg ':3000 ' | rg -o 'pid=([0-9]+)' -r1); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1
cd .next/standalone
setsid nohup env NODE_ENV=production bun server.js >> "$P/server.log" 2>&1 < /dev/null &
cd "$P"

UP=0
for i in $(seq 1 40); do
  sleep 3
  if curl -s -o /dev/null -m 3 http://localhost:3000/; then UP=1; break; fi
done

if [ "$UP" = "1" ]; then
  log "السيرفر يعمل الآن على :3000 ✓"
  log "=== REPAIR-DONE ✓ ==="
  write_stats "success"
else
  log "⚠ السيرفر لم يستجب بعد — أعد تحميل الصفحة بعد دقيقة"
  echo "REPAIR-FAILED" >> "$LOG"
  write_stats "failed"
  exit 1
fi
