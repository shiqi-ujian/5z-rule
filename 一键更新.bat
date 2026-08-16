@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)
node 5z_build\update.mjs %*
set EC=%ERRORLEVEL%
echo.
if %EC%==0 (echo === Done, press any key to close ===) else (echo === FAILED, see log above ===)
if "%WZ_NO_PAUSE%"=="" pause >nul
exit /b %EC%
