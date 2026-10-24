@echo off
setlocal
py -3.12 "%~dp0scripts\setup_moss.py" %*
exit /b %errorlevel%
