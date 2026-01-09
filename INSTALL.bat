@echo off
title Claude Code Telegram Bridge - One-Click Installer
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║     Claude Code Telegram Bridge Installer   ║
echo  ║           One-Click Setup                    ║
echo  ╚══════════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not found! 
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo Then run this installer again.
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js detected
echo.

REM Check if we're in the right directory
if not exist package.json (
    echo ❌ package.json not found!
    echo Please run this installer from the telegram bridge directory.
    pause
    exit /b 1
)

echo 📦 Installing dependencies...
echo.
call npm install --silent
if errorlevel 1 (
    echo ❌ Failed to install dependencies
    echo Please check your internet connection and try again.
    pause
    exit /b 1
)

echo ✅ Dependencies installed successfully
echo.

echo 🔧 Starting interactive setup...
echo.
call npm run setup
if errorlevel 1 (
    echo ❌ Setup failed
    pause
    exit /b 1
)

echo.
echo ✅ Setup completed successfully!
echo.

REM Ask if user wants to start the bridge now
echo Would you like to start the Telegram bridge now? (Y/N)
set /p choice="> "

if /I "%choice%"=="Y" (
    echo.
    echo 🚀 Starting Claude Code Telegram Bridge...
    echo.
    echo ℹ️  Press Ctrl+C to stop the bridge
    echo ℹ️  Send /ping to your bot in Telegram to test!
    echo.
    call npm start
) else (
    echo.
    echo 📋 To start the bridge later, run:
    echo    npm start
    echo.
    echo 📖 Check SETUP.md for usage instructions
)

echo.
echo 🎉 Installation complete!
pause