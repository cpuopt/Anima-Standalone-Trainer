@echo off
cd /d "%~dp0"
echo Starting Anima Training UI...
if not exist node_modules (
    call npm ci
    if errorlevel 1 exit /b 1
)
call npm start
echo.
echo Application exited (check for errors above).
pause
