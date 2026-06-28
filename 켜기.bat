@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ilust-bot launcher

set "COMFYUI_DIR=C:\ComfyUI_windows_portable"
set "COMFYUI_BAT=%COMFYUI_DIR%\run_nvidia_gpu.bat"
set "COMFYUI_HEALTH_URL=http://127.0.0.1:8188/system_stats"
set "COMFYUI_READY_TIMEOUT_SECONDS=90"

echo ==============================
echo ilust-bot launcher
echo ==============================
echo.

if not exist "%COMFYUI_BAT%" (
  echo [ERROR] ComfyUI launcher not found:
  echo %COMFYUI_BAT%
  goto :fail
)

if not exist ".env" (
  echo [ERROR] .env file not found in:
  echo %CD%
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node was not found. Install Node.js first.
  goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js first.
  goto :fail
)

echo [1/3] Starting ComfyUI...
start "ComfyUI" /D "%COMFYUI_DIR%" "%COMFYUI_BAT%"
echo.

echo [2/3] Waiting for ComfyUI at %COMFYUI_HEALTH_URL%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(%COMFYUI_READY_TIMEOUT_SECONDS%);" ^
  "while ((Get-Date) -lt $deadline) {" ^
  "  try {" ^
  "    $response=Invoke-WebRequest -UseBasicParsing -Uri '%COMFYUI_HEALTH_URL%' -TimeoutSec 5;" ^
  "    if ($response.StatusCode -eq 200) { exit 0 }" ^
  "  } catch {}" ^
  "  Start-Sleep -Seconds 2;" ^
  "}" ^
  "exit 1"
if errorlevel 1 (
  echo [ERROR] ComfyUI did not respond within %COMFYUI_READY_TIMEOUT_SECONDS% seconds.
  echo Check whether ComfyUI finished loading or if COMFYUI_BASE_URL is correct.
  goto :fail
)
echo.

echo [3/3] Starting Discord bot...
echo This window will stay open even if the bot exits.
echo.
call npm start
set "BOT_EXIT_CODE=%ERRORLEVEL%"
echo.

if "%BOT_EXIT_CODE%"=="0" (
  echo [INFO] Bot process exited normally.
) else (
  echo [ERROR] Bot process exited with code %BOT_EXIT_CODE%.
)

goto :end

:fail
echo.
echo Launcher stopped.

:end
echo.
pause
endlocal
