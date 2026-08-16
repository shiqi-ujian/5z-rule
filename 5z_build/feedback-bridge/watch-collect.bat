@echo off
cd /d "%~dp0..\.."
where node >nul 2>nul || (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)
echo Starting Tencent Docs form collector watcher (default every 30 min).
echo Log: 5z_build\feedback-bridge\collect.log  -  Press Ctrl+C to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "5z_build\feedback-bridge\watch-collect.ps1"
if "%WZ_NO_PAUSE%"=="" pause >nul
