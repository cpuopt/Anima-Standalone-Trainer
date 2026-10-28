@echo off
setlocal
node "%~dp0training-ui\scripts\manage-environment.js" anima-lumina %*
exit /b %errorlevel%
