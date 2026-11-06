#!/bin/bash
# AI Studio — نسخة الكمبيوتر الكاملة (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  AI Studio — نسخة الكمبيوتر الكاملة"
echo "============================================================"

# ---- 1) فحص المتطلبات ----
if ! command -v node >/dev/null 2>&1; then
  echo "[X] Node.js غير مثبت — ثبّت نسخة LTS من https://nodejs.org ثم أعد المحاولة"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[X] Python3 غير مثبت — ثبّته من مدير حزم نظامك ثم أعد المحاولة"
  exit 1
fi

# ---- 2) نماذج تبديل الوجوه (أول مرة) ----
if [ ! -f "$HOME/.insightface/models/inswapper_128.onnx" ] && [ -f models-insightface/inswapper_128.onnx ]; then
  echo "[1/4] تجهيز نماذج تبديل الوجوه — مرة واحدة فقط…"
  mkdir -p "$HOME/.insightface/models"
  cp -r models-insightface/buffalo_l "$HOME/.insightface/models/"
  cp models-insightface/inswapper_128.onnx "$HOME/.insightface/models/"
fi

# ---- 3) حزم بايثون (أول مرة) ----
if ! python3 -m pip show fastapi >/dev/null 2>&1; then
  echo "[2/4] تثبيت حزم بايثون — مرة واحدة فقط…"
  python3 -m pip install -r requirements.txt || python3 -m pip install --user -r requirements.txt
fi

# ---- 4) البناء (يستخدم سكربت الإنتاج الذاتي الإصلاح) ----
echo "[3/4] تجهيز وبناء التطبيق (أول مرة: من 5 إلى 15 دقيقة)…"
bash scripts/start-production.sh &
APP_PID=$!

# ---- 5) فتح المتصفح ----
sleep 5
echo "[4/4] التطبيق يعمل على: http://localhost:3000  (للإيقاف: Ctrl+C)"
( sleep 8; (xdg-open http://localhost:3000 >/dev/null 2>&1 || open http://localhost:3000 >/dev/null 2>&1 || true) ) &
wait $APP_PID
