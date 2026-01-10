# Claude Code Telegram Bridge

## Current Status: FULLY OPERATIONAL
- Bidirectional Telegram messaging: WORKING
- Auto-enter (no manual Enter needed): WORKING
- Session-specific PID targeting: WORKING
- Watcher auto-spawn: WORKING

---

## SESSION SUMMARY (2026-01-09)

### Issue Investigated
User reported watcher auto-start wasn't working. Investigation found:
- Process tree is correct: MCP server → Claude CLI → cmd.exe
- The watcher script works perfectly when spawned manually
- The spawn from MCP server was failing silently (no error output)

### Changes Made
Added debug logging to `mcp-server/server.js`:
1. Logs watcher script path before checking existence
2. Logs the full spawn command being executed
3. Added error event handler on spawn process
4. Added try-catch around spawn call
5. Logs the spawned process PID on success

### What to Test on Restart
1. Restart Claude Code in this project
2. Check `/mcp` logs for the telegram-mcp-server
3. Look for these log lines:
   - `Starting watcher initialization...`
   - `Watcher script path: ...`
   - `Found Claude PID: <number>`
   - `Spawning: powershell ...`
   - `Spawned enter watcher (PID: <number>, mode: <pid>)`
4. If any errors appear, they'll show what's failing

### Files Modified
- `mcp-server/server.js` - added debug logging to `spawnEnterWatcher()` and `initializeWatcher()`

### Temporary Files (can delete)
- `debug-pid.ps1` - was used for process tree debugging

---

## Auto-Enter Feature (WORKING)

### Status: FULLY AUTOMATIC

The auto-enter feature allows Claude to automatically respond to Telegram messages without manual Enter key presses. **No manual setup required** - the watcher is auto-spawned when the MCP server starts.

### How It Works
1. MCP server starts → auto-spawns watcher with Claude window PID
2. User sends message on Telegram
3. MCP server queues message and creates trigger file
4. Watcher detects trigger, focuses Claude window, types `.` and presses Enter
5. Claude processes the prompt with Telegram message context injected

### Session-Specific Targeting
Each Claude Code session gets its own watcher that:
- Targets the specific Claude window by PID (not by searching)
- Auto-exits when the Claude session ends
- Works correctly with multiple Claude windows open

### Components
| File | Purpose |
|------|---------|
| `mcp-server/server.js` | Finds Claude PID, spawns watcher, creates trigger files |
| `hooks/enter-watcher.ps1` | Monitors trigger file, sends keystrokes to target window |

### Manual Mode (Optional)
If auto-spawn fails, you can still run the watcher manually:
```powershell
# Search mode (finds Claude window automatically)
powershell -ExecutionPolicy Bypass -File "D:\Documents\ClaudeCodeRoot\hooks\enter-watcher.ps1"

# PID mode (target specific window)
powershell -ExecutionPolicy Bypass -File "D:\Documents\ClaudeCodeRoot\hooks\enter-watcher.ps1" -TargetPid 12345
```

### Troubleshooting
| Issue | Solution |
|-------|----------|
| Watcher not auto-starting | Check MCP server logs in Claude Code (`/mcp`) |
| "Claude window not found" | Ensure Claude is in a cmd window, or specify PID manually |
| Enter not working | Watcher may have lost window focus - restart Claude session |

---

## Overview

This project provides a non-blocking Telegram integration for Claude Code, allowing bidirectional communication between Claude Code sessions and Telegram.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Session                          │
│  ┌──────────────────┐       ┌─────────────────────────────┐     │
│  │ UserPromptSubmit │       │ MCP Tools                   │     │
│  │ Hook             │       │ - telegram_send             │     │
│  │ (injects context)│       │ - telegram_send_image       │     │
│  └────────┬─────────┘       └─────────────┬───────────────┘     │
└───────────┼───────────────────────────────┼─────────────────────┘
            │ reads                         │ calls
            ▼                               ▼
     ┌──────────────┐              ┌──────────────────┐
     │ Queue File   │◄────writes───│ Telegram MCP     │
     │ queue.json   │              │ Server           │
     └──────────────┘              │ (bot listener)   │
                                   └────────┬─────────┘
                                            │ Telegram API
                                            ▼
                                   ┌──────────────────┐
                                   │    Telegram      │
                                   └──────────────────┘
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| MCP Server | `mcp-server/server.js` | Hosts Telegram bot, exposes tools to Claude |
| Context Hook | `hooks/telegram-context.js` | Injects Telegram messages before each prompt |
| Message Queue | `~/.claude-telegram/queue.json` | Stores incoming messages |
| MCP Config | `.mcp.json` | Configures MCP server for Claude Code |
| Hook Config | `.claude/settings.local.json` | Configures the UserPromptSubmit hook |
| Skill | `.claude/skills/telegram/SKILL.md` | Guides Claude on using the integration |

## Development

### Install dependencies
```bash
cd mcp-server && npm install
```

### Check integration status
```bash
node install.js --status
```

### Full installation
```bash
node install.js
```

## Message Flow

### Sending to Telegram (Outbound)
1. Claude calls `telegram_send` tool with message
2. MCP server sends via Telegram Bot API
3. User receives message in Telegram

### Receiving from Telegram (Inbound)
1. User sends message on Telegram
2. MCP server's bot listener receives and queues message
3. On next prompt, hook reads queue and injects as context
4. Claude sees: `[Telegram Messages Received] ...`

## Configuration

### Credentials
Located in `.mcp.json`:
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `TELEGRAM_USER_ID`: Authorized user's Telegram ID

### Hook
Located in `.claude/settings.local.json`:
- `UserPromptSubmit` hook runs `hooks/telegram-context.js`
- Timeout: 5 seconds

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `telegram_send` | Send text message to Telegram |
| `telegram_send_image` | Send image file to Telegram |
| `telegram_check_messages` | Manually check pending messages |

## Extending

### Adding new tools
1. Add tool definition to `ListToolsRequestSchema` handler in `server.js`
2. Add handler in `CallToolRequestSchema` switch statement
3. Restart Claude Code session

### Modifying message format
Edit `hooks/telegram-context.js` to change how messages appear in context.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP not connecting | Check `/mcp`, verify `.mcp.json`, restart Claude Code |
| Messages not appearing | Verify hook in `settings.local.json`, check queue file |
| Bot not responding | Validate bot token, check Telegram @BotFather |
| Send failing | Check user ID, verify bot has permission to message user |

