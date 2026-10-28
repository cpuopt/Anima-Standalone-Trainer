@echo off
setlocal
node "%~dp0training-ui\scripts\manage-environment.js" krea2 %*
exit /b %errorlevel%
