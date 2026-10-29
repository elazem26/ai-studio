@echo off
setlocal enabledelayedexpansion
title AI Studio v5.5.0 - Launcher
cd /d "%~dp0"

echo.
echo  ==============================================
echo    AI Studio v5.5.0  -  One-Click Launcher
echo    Starting everything automatically...
echo  ==============================================
echo.

rem ---------- [1/4] Runtime (Node.js / Bun) ----------
set "RUNTIME="
where bun >nul 2>nul && (set "RUNTIME=bun" & goto runtime_ok)
where node >nul 2>nul && (set "RUNTIME=node" & goto runtime_ok)
if exist "runtime\node\node.exe" (
  set "PATH=%CD%\runtime\node;%PATH%"
  set "RUNTIME=node"
  goto runtime_ok
)
echo  [1/4] Node.js not found - downloading portable Node.js (one time)...
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip' -OutFile 'node.zip' } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo  ERROR: could not download Node.js automatically.
  echo  Please install Node.js from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
powershell -NoProfile -Command "Expand-Archive -Path 'node.zip' -DestinationPath 'runtime' -Force"
if exist "runtime\node-v20.18.1-win-x64\node.exe" move "runtime\node-v20.18.1-win-x64" "runtime\node" >nul
del node.zip >nul 2>nul
set "PATH=%CD%\runtime\node;%PATH%"
set "RUNTIME=node"

:runtime_ok
echo  [1/4] Runtime found: %RUNTIME%
echo.

rem ---------- [2/4] Dependencies ----------
if exist "node_modules\next" (
  echo  [2/4] Dependencies already installed - OK
) else (
  echo  [2/4] Installing dependencies - first run only, 2-5 minutes...
  if "%RUNTIME%"=="bun" (
    call bun install
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo  ERROR: install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo.

rem ---------- [3/4] Database ----------
if exist "db\custom.db" (
  echo  [3/4] Database found - OK
) else (
  echo  [3/4] Preparing database...
  if not exist "db" mkdir db
  if "%RUNTIME%"=="bun" (
    call bunx prisma generate >nul 2>nul
    call bunx prisma db push --accept-data-loss
  ) else (
    call npx prisma generate >nul 2>nul
    call npx prisma db push --accept-data-loss
  )
)
echo.

rem ---------- [4/4] Start server ----------
echo  [4/4] Starting AI Studio server...
start "AI-Studio-Server" /min cmd /c "npx next dev -p 3000 > server.log 2>&1"

set /a TRIES=0
:waitloop
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 3; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  set /a TRIES+=1
  if !TRIES! GEQ 60 (
    echo  ERROR: server did not start within 3 minutes. Open server.log for details.
    pause
    exit /b 1
  )
  goto waitloop
)

start "" http://localhost:3000
echo.
echo  ==============================================
echo    AI Studio is RUNNING in your browser now:
echo    http://localhost:3000
echo.
echo    Keep this window open while using the app.
echo    Press any key in this window to STOP the app.
echo  ==============================================
pause >nul
taskkill /fi "WINDOWTITLE eq AI-Studio-Server*" >nul 2>nul
echo  AI Studio stopped.
timeout /t 2 /nobreak >nul
