#!/bin/bash
# بناء حزمة نسخة الكمبيوتر الكاملة AI-Studio-Desktop
set -e
cd /home/z/my-project
STG=/home/z/my-project/.desktop-pkg/AI-Studio-Desktop
rm -rf "$STG"; mkdir -p "$STG"

echo "[1/6] تصدير ملفات المشروع المتتبعة (نفس حالة GitHub)…"
git archive HEAD | tar -x -C "$STG"

echo "[2/6] نموذج إزالة الكائنات (199MB)…"
mkdir -p "$STG/data/models" "$STG/data/uploads" "$STG/data/results" "$STG/data/db" "$STG/db"
cp data/models/lama_fp32.onnx "$STG/data/models/"

echo "[3/6] قاعدة البيانات الحالية…"
cp db/custom.db "$STG/db/custom.db"

echo "[4/6] نماذج تبديل الوجوه insightface (856MB)…"
mkdir -p "$STG/models-insightface"
cp -r ~/.insightface/models/buffalo_l "$STG/models-insightface/"
cp ~/.insightface/models/inswapper_128.onnx "$STG/models-insightface/"

echo "[5/6] مجلدات التشغيل الفارغة…"
mkdir -p "$STG/mini-services/face-swap-pro/data/results" "$STG/mini-services/object-remover/data" 2>/dev/null || true

echo "[6/6] ملفات الإعداد والتشغيل…"
# .env محلي لقاعدة sqlite النسبية (يُصحح لمطلق عند التشغيل)
cat > "$STG/.env" <<'EOF'
DATABASE_URL=file:./db/custom.db
EOF
chmod +x "$STG"/scripts/*.sh 2>/dev/null || true

echo "--- القياس ---"
du -sh "$STG"
echo "OK"
