@echo off
cd /d "%~dp0"
echo Starting Anima Client Portal (Independent Port Service)...
if not exist node_modules (
    call npm ci
    if errorlevel 1 exit /b 1
)
set "PORTAL_PORT=%~1"
if "%PORTAL_PORT%"=="" set "PORTAL_PORT=3100"
node client-portal-server.js --port=%PORTAL_PORT%
echo.
echo Client Portal exited (check for errors above).
pause
