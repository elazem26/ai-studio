@echo off
title AI Studio Launcher
cd /d "%~dp0"

REM ===== Check if already running =====
curl -s http://localhost:3000 >nul 2>nul
if %errorlevel% equ 0 (
    echo AI Studio already running — opening browser...
    start http://localhost:3000
    exit /b 0
)

echo ============================================
echo        AI Studio Launcher
echo ============================================
echo.

REM ===== Check dependencies =====
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Download from: https://nodejs.org
    start https://nodejs.org
    pause
    exit /b 1
)

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found!
    echo Download from: https://python.org
    start https://python.org
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] ffmpeg not found!
    echo Download from: https://ffmpeg.org
    start https://ffmpeg.org/download.html
    pause
    exit /b 1
)

echo [OK] Node.js
echo [OK] Python
echo [OK] ffmpeg
echo.

REM ===== Check node_modules =====
if not exist "node_modules" (
    echo Installing dependencies (first time only)...
    call npm install
    echo.
)

REM ===== Check insightface =====
python -c "import insightface" 2>nul
if %errorlevel% neq 0 (
    echo Installing insightface (first time only)...
    call pip install insightface onnxruntime opencv-python-headless
    echo.
)

REM ===== Check model file =====
if not exist "mini-services\face-swap-pro\models\inswapper_128.onnx" (
    echo Downloading face-swap model (530MB, first time only)...
    if not exist "mini-services\face-swap-pro\models" mkdir "mini-services\face-swap-pro\models"
    curl -L -o "mini-services\face-swap-pro\models\inswapper_128.onnx" "https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
    echo Model downloaded.
    echo.
)

REM ===== Start face-swap service =====
echo Starting face-swap service...
start "AI-Studio-FaceSwap" /min cmd /c "cd mini-services\face-swap-pro && python server.py"
timeout /t 4 /nobreak >nul

REM ===== Start Next.js =====
echo Starting AI Studio...
echo.

REM ===== Open browser after Next.js is ready =====
start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

REM ===== Run Next.js (this keeps the window open) =====
echo ============================================
echo  AI Studio is starting...
echo  Browser will open automatically at:
echo  http://localhost:3000
echo.
echo  Keep this window open while using AI Studio.
echo  Close it to stop.
echo ============================================
echo.
call npm run dev

REM ===== Cleanup when stopped =====
echo.
echo Stopping AI Studio...
taskkill /fi "WindowTitle eq AI-Studio-FaceSwap*" /f 2>nul
echo Done.
timeout /t 2 /nobreak >nul
