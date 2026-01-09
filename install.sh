#!/bin/bash

# Claude Code Telegram Bridge - One-Click Installer
# Works on Linux, macOS, and Windows (via Git Bash/WSL)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════╗"
echo "║     Claude Code Telegram Bridge Installer   ║"
echo "║           One-Click Setup                    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found!${NC}"
    echo
    echo "Please install Node.js from: https://nodejs.org"
    echo "Then run this installer again."
    exit 1
fi

echo -e "${GREEN}✅ Node.js detected${NC}"
echo

# Check if we're in the right directory
if [ ! -f package.json ]; then
    echo -e "${RED}❌ package.json not found!${NC}"
    echo "Please run this installer from the telegram bridge directory."
    exit 1
fi

echo -e "${YELLOW}📦 Installing dependencies...${NC}"
echo
npm install --silent

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Dependencies installed successfully${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    echo "Please check your internet connection and try again."
    exit 1
fi

echo
echo -e "${YELLOW}🔧 Starting interactive setup...${NC}"
echo
npm run setup

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Setup completed successfully!${NC}"
else
    echo -e "${RED}❌ Setup failed${NC}"
    exit 1
fi

echo
echo -e "${YELLOW}Would you like to start the Telegram bridge now? (y/N)${NC}"
read -r choice

case "$choice" in 
    y|Y|yes|Yes ) 
        echo
        echo -e "${BLUE}🚀 Starting Claude Code Telegram Bridge...${NC}"
        echo
        echo -e "${YELLOW}ℹ️  Press Ctrl+C to stop the bridge${NC}"
        echo -e "${YELLOW}ℹ️  Send /ping to your bot in Telegram to test!${NC}"
        echo
        npm start
        ;;
    * ) 
        echo
        echo -e "${YELLOW}📋 To start the bridge later, run:${NC}"
        echo "   npm start"
        echo
        echo -e "${YELLOW}📖 Check SETUP.md for usage instructions${NC}"
        ;;
esac

echo
echo -e "${GREEN}🎉 Installation complete!${NC}"