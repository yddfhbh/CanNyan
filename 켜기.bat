@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ilust-bot launcher

set "COMFYUI_DIR=C:\ComfyUI_windows_portable"
set "COMFYUI_BAT=%COMFYUI_DIR%\run_nvidia_gpu.bat"
set "START_DELAY_SECONDS=15"

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

echo [2/3] Waiting %START_DELAY_SECONDS% seconds for ComfyUI...
timeout /t %START_DELAY_SECONDS% /nobreak >nul
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
