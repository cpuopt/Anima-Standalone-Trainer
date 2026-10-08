@echo off
setlocal
where py >nul 2>nul
if errorlevel 1 (
    python "%~dp0scripts\setup_krea2.py" %*
) else (
    py -3.12 "%~dp0scripts\setup_krea2.py" %*
)
exit /b %errorlevel%
