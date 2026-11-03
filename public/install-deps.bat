@echo off
title AI Studio — Install Dependencies
echo ============================================
echo    AI Studio — Dependency Installer
echo ============================================
echo.

REM ===== Check Python =====
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Python not found!
        echo Download from: https://python.org
        echo Make sure to check "Add Python to PATH" during installation
        start https://python.org
        pause
        exit /b 1
    )
    set PYTHON=py
) else (
    set PYTHON=python
)
echo [OK] Python: %PYTHON%
%PYTHON% --version
echo.

REM ===== Install Python dependencies =====
echo Installing face-swap dependencies...
echo This may take a few minutes (first time only)...
echo.
%PYTHON% -m pip install --upgrade pip
%PYTHON% -m pip install insightface onnxruntime opencv-python-headless numpy Pillow fastapi uvicorn python-multipart
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python packages
    echo Try: %PYTHON% -m pip install insightface onnxruntime opencv-python-headless numpy Pillow fastapi uvicorn
    pause
    exit /b 1
)
echo.
echo [OK] Python dependencies installed
echo.

REM ===== Check model file =====
if not exist "mini-services\face-swap-pro\models\inswapper_128.onnx" (
    echo Downloading face-swap model (530MB)...
    if not exist "mini-services\face-swap-pro\models" mkdir "mini-services\face-swap-pro\models"
    curl -L -o "mini-services\face-swap-pro\models\inswapper_128.onnx" "https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to download model
        echo Try downloading manually from:
        echo https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx
        echo Save to: mini-services\face-swap-pro\models\inswapper_128.onnx
        pause
        exit /b 1
    )
    echo [OK] Model downloaded
) else (
    echo [OK] Model already exists
)
echo.

REM ===== Test face-swap service =====
echo Testing face-swap service...
cd mini-services\face-swap-pro
start /wait cmd /c "%PYTHON% -c \"from fastapi import FastAPI; print('FastAPI OK')\""
if %errorlevel% neq 0 (
    echo [ERROR] FastAPI not installed properly
    echo Run: %PYTHON% -m pip install fastapi uvicorn
    pause
    exit /b 1
)
echo [OK] FastAPI works
echo.

REM ===== Test insightface =====
%PYTHON% -c "import insightface; print('insightface version:', insightface.__version__)"
if %errorlevel% neq 0 (
    echo [ERROR] insightface not installed properly
    echo Run: %PYTHON% -m pip install insightface onnxruntime
    pause
    exit /b 1
)
echo [OK] insightface works
echo.

echo ============================================
echo  All dependencies installed successfully!
echo  Now run AI-Studio-Launcher.bat to start
echo ============================================
pause
