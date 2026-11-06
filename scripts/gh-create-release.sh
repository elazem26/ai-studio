#!/bin/bash
# إنشاء Release v5.6.0 ورفع حزمة سطح المكتب (957MB) في الخلفية
set -e
GH_TOKEN=$(cat /home/z/my-project/data/.gh-token | head -1)
API="https://api.github.com"
H=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json")
REPO=elazem26/ai-studio
ZIP=/home/z/my-project/download/AI-Studio-Desktop-v5.6.0.zip

ACTION="${1:-create}"

if [ "$ACTION" = "create" ]; then
  BODY=$(cat <<'EOF'
{
  "tag_name": "v5.6.0",
  "target_commitish": "main",
  "name": "AI Studio v5.6.0 — نسخة الكمبيوتر الكاملة",
  "body": "## نسخة الكمبيوتر الكاملة — تعمل محلياً 100%\n\n**الجديد في v5.6.0:** أداة إزالة الكائنات بالفرشاة (نموذج LaMa المحلي): مسح الشموع/الكتابة/الشعارات/الإيموجي/الساعات/الحلق مع ترميم ما خلفها — البكسلات خارج التحديد تبقى مطابقة حرفياً.\n\n### المحتويات\n- كود التطبيق الكامل (Next.js + خدمات Python)\n- نماذج إزالة الكائنات LaMa (199MB)\n- نماذج تبديل الوجوه insightface: buffalo_l + inswapper_128 (856MB)\n- قاعدة البيانات + ملفات التشغيل الجاهزة\n\n### التشغيل\n1. فك الضغط في مجلد ثابت\n2. ويندوز: `START-WINDOWS.bat` — ماك/لينكس: `bash START-MAC-LINUX.sh`\n3. أول تشغيل 10-20 دقيقة (تثبيت وبناء تلقائي)، ثم يفتح المتصفح على http://localhost:3000\n\n### المتطلبات\n- Node.js LTS: https://nodejs.org\n- Python 3.10+: https://www.python.org/downloads/ (مع Add to PATH)\n\nالتفاصيل الكاملة في README-FIRST.md داخل الحزمة.",
  "draft": false,
  "prerelease": false
}
EOF
)
  RESP=$(curl -sS "${H[@]}" -X POST "$API/repos/$REPO/releases" -d "$BODY")
  ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  if [ -z "$ID" ]; then echo "FATAL: create failed"; echo "$RESP" | head -c 400; exit 1; fi
  echo "release-id=$ID"
  echo "$ID" > /tmp/gh-release-id
fi

ID=$(cat /tmp/gh-release-id)
UPLOAD_URL="https://uploads.github.com/repos/$REPO/releases/$ID/assets?name=AI-Studio-Desktop-v5.6.0.zip"
echo "بدء رفع الأصل (957MB)…"
curl -sS -o /tmp/gh-upload-resp.json -w "%{http_code}" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @"$ZIP" \
  --max-time 3000 \
  "$UPLOAD_URL" > /tmp/gh-upload-code
echo "upload-code=$(cat /tmp/gh-upload-code)"
