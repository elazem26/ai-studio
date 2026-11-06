@echo off
chcp 65001 >nul
title AI Studio - Desktop
cd /d "%~dp0"

echo ============================================================
echo   AI Studio - نسخة الكمبيوتر الكاملة
echo ============================================================
echo.

rem ---- 1) فحص المتطلبات ----
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js غير مثبت.
  echo     ثبّت نسخة LTS من: https://nodejs.org
  echo     ثم أعد تشغيل هذا الملف.
  pause
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo [X] Python غير مثبت.
  echo     ثبّته من: https://www.python.org/downloads/
  echo     وأثناء التثبيت فعّل خيار: Add python.exe to PATH
  echo     ثم أعد تشغيل هذا الملف.
  pause
  exit /b 1
)

set "DATABASE_URL=file:%cd:\=/%/db/custom.db"

rem ---- 2) نماذج تبديل الوجوه إلى مجلد المستخدم (أول مرة) ----
if not exist "%USERPROFILE%\.insightface\models\inswapper_128.onnx" (
  if exist "models-insightface\inswapper_128.onnx" (
    echo [1/4] تجهيز نماذج تبديل الوجوه - مرة واحدة فقط...
    if not exist "%USERPROFILE%\.insightface\models" mkdir "%USERPROFILE%\.insightface\models"
    robocopy "models-insightface\buffalo_l" "%USERPROFILE%\.insightface\models\buffalo_l" /E /NFL /NDL /NJH /NJS /NP >nul
    copy /Y "models-insightface\inswapper_128.onnx" "%USERPROFILE%\.insightface\models\" >nul
  )
)

rem ---- 3) حزم بايثون للخدمات (أول مرة) ----
python -m pip show fastapi >nul 2>nul
if errorlevel 1 (
  echo [2/4] تثبيت حزم بايثون - مرة واحدة فقط...
  python -m pip install -r requirements.txt
)

rem ---- 4) حزم Node + بناء التطبيق (أول مرة فقط) ----
if not exist node_modules (
  echo [3/4] تثبيت حزم المشروع - من 3 إلى 10 دقائق...
  call npm install --no-audit --no-fund
  if errorlevel 1 (echo فشل تثبيت الحزم - تحقق من الاتصال ثم أعد المحاولة & pause & exit /b 1)
)
if not exist db\custom.db (
  if not exist db mkdir db
  call npx --yes prisma db push --accept-data-loss --skip-generate
)
call npx --yes prisma generate >nul 2>nul
if not exist ".next\standalone\server.js" (
  echo [4/4] بناء التطبيق - من 5 إلى 15 دقيقة - مرة واحدة فقط...
  call npx next build
  if errorlevel 1 (echo فشل البناء & pause & exit /b 1)
  if not exist ".next\standalone\.next\static" xcopy /E /I /Y ".next\static" ".next\standalone\.next\static" >nul
  if not exist ".next\standalone\public" xcopy /E /I /Y "public" ".next\standalone\public" >nul
)

rem ---- 5) التشغيل ----
echo.
echo ============================================================
echo   جارٍ التشغيل... افتح المتصفح على: http://localhost:3000
echo   لإيقاف التطبيق: أغلق هذه النافذة
echo ============================================================
start "" http://localhost:3000
set PORT=3000
set HOSTNAME=0.0.0.0
node .next\standalone\server.js
pause
