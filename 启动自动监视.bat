@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)
echo Starting watcher. Drop a new CHM into the incoming folder.
echo Log: 5z_build\watch.log  -  Press Ctrl+C to stop.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "5z_build\watch.ps1"
if "%WZ_NO_PAUSE%"=="" pause >nul
