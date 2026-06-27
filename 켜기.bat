@echo off
setlocal
cd /d "%~dp0"

set "COMFYUI_DIR=C:\ComfyUI_windows_portable"
set "COMFYUI_BAT=%COMFYUI_DIR%\run_nvidia_gpu.bat"
set "START_DELAY_SECONDS=10"

if not exist "%COMFYUI_BAT%" (
  echo [ERROR] ComfyUI 실행 파일을 찾지 못했습니다.
  echo %COMFYUI_BAT%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm을 찾지 못했습니다. Node.js 설치를 확인해주세요.
  pause
  exit /b 1
)

echo [1/2] ComfyUI 실행...
start "ComfyUI" /D "%COMFYUI_DIR%" "%COMFYUI_BAT%"

echo [2/2] 봇 실행 준비...
echo ComfyUI가 올라올 시간을 %START_DELAY_SECONDS%초 기다립니다.
timeout /t %START_DELAY_SECONDS% /nobreak >nul

echo bot starting...
call npm start

endlocal
