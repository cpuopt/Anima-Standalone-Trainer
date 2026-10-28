@echo off
setlocal
node "%~dp0training-ui\scripts\manage-environment.js" moss %*
exit /b %errorlevel%
