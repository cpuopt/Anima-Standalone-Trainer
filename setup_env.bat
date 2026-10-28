@echo off
cd /d %~dp0

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Node.js is not installed. Attempting automatic installation...
    echo.

    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        echo Installing Node.js via winget...
        winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
        if %errorlevel% neq 0 (
            echo.
            echo [ERROR] winget install failed.
            echo Please install Node.js manually from: https://nodejs.org/
            echo.
            pause
            exit /b 1
        )
        echo.
        echo [INFO] Node.js installed. Refreshing PATH...
        call RefreshEnv.cmd >nul 2>&1
        set "PATH=%PATH%;%ProgramFiles%\nodejs"
    ) else (
        echo winget not available. Downloading Node.js installer...
        echo.
        set "NODE_INSTALLER=%TEMP%\node_installer.msi"
        powershell -Command "$v = (Invoke-RestMethod 'https://nodejs.org/dist/index.json')[0].version; Invoke-WebRequest -Uri \"https://nodejs.org/dist/$v/node-$v-x64.msi\" -OutFile '%NODE_INSTALLER%'"
        if %errorlevel% neq 0 (
            echo.
            echo [ERROR] Failed to download Node.js installer.
            echo Please install manually from: https://nodejs.org/
            echo.
            pause
            exit /b 1
        )
        echo Running Node.js installer silently...
        msiexec /i "%NODE_INSTALLER%" /quiet /norestart
        if %errorlevel% neq 0 (
            echo.
            echo [ERROR] Node.js installation failed.
            echo Please install manually from: https://nodejs.org/
            echo.
            pause
            exit /b 1
        )
        del "%NODE_INSTALLER%" >nul 2>&1
        set "PATH=%PATH%;%ProgramFiles%\nodejs"
        echo Node.js installed successfully.
    )

    node -v >nul 2>&1
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Node.js still not found after installation.
        echo Please restart this script, or install Node.js manually and reopen a new terminal.
        echo Download from: https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
)
echo Node.js detected.
echo.

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)"
if errorlevel 1 (
    echo [ERROR] Node.js 20.19 or 22.12 and newer is required for the UI build.
    exit /b 1
)
python "%~dp0scripts\bootstrap_environment.py"
if errorlevel 1 exit /b 1
cd /d "%~dp0training-ui"
call npm ci
if errorlevel 1 exit /b 1
call npm --prefix frontend ci
if errorlevel 1 exit /b 1
call npm --prefix frontend run build
if errorlevel 1 exit /b 1
echo Main control environment and UI ready. Install models from Global Settings.
