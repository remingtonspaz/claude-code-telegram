# Claude Code Telegram Bridge

## Current Status: FULLY OPERATIONAL
- Bidirectional Telegram messaging: WORKING
- Auto-enter (no manual Enter needed): WORKING
- Session-specific PID targeting: WORKING
- Watcher auto-spawn: WORKING
- **Permission control via Telegram: TESTING** (new feature)

---

## SESSION SUMMARY (2026-01-09 - Session 2)

### New Feature: Telegram Permission Control
Built a system to control Claude Code's permission prompts via Telegram.

#### How It Works
1. When Claude requests permission for a tool, `PermissionRequest` hook fires
2. Hook sends Telegram notification: "🔐 Permission Request - Tool: X"
3. User replies y/n/a on Telegram
4. MCP server receives response, writes to `permission-response.json`
5. Watcher sends the keystroke (y/n/a + Enter) to Claude window

#### New Files
- `hooks/permission-telegram.cjs` - PermissionRequest hook that notifies Telegram (uses .cjs for CommonJS compatibility)

#### Modified Files
- `mcp-server/server.js` - Added permission response handling (y/n/a detection)
- `hooks/enter-watcher.ps1` - Now checks for permission responses before sending keys
- `.claude/settings.local.json` - Added PermissionRequest hook config

#### Testing Needed
1. Restart Claude Code
2. Trigger a tool that needs permission (something not in allow list)
3. Check Telegram for "🔐 Permission Request" message
4. Reply y, n, or a
5. Verify keystroke is sent and Claude continues

#### Files Involved
| File | Purpose |
|------|---------|
| `~/.claude-telegram/pending-permission.json` | Stores current permission request |
| `~/.claude-telegram/permission-response.json` | User's y/n/a response |

---

## Previous Session (2026-01-09 - Session 1)

### Issue Investigated
Watcher auto-start wasn't working. Added debug logging to diagnose.

### Result
After restart, watcher auto-spawn confirmed WORKING.

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

## Permission Control via Telegram (NEW)

### Status: TESTING

Control Claude Code's permission prompts (Y/n/always) remotely via Telegram.

### How It Works
1. Claude requests permission for a tool not in the allow list
2. `PermissionRequest` hook fires and sends Telegram notification
3. You receive: "🔐 Permission Request - Tool: Bash - `some command`"
4. Reply with: `y` (yes), `n` (no), or `a` (always)
5. MCP server detects response, writes to response file
6. Watcher sends the keystroke to Claude window
7. You receive confirmation: "✅ Permission: Yes/No/Always"

### Components
| File | Purpose |
|------|---------|
| `hooks/permission-telegram.cjs` | PermissionRequest hook - sends notifications |
| `mcp-server/server.js` | Handles y/n/a responses from Telegram |
| `hooks/enter-watcher.ps1` | Sends permission keystrokes |

### Response Options
| Reply | Effect |
|-------|--------|
| `y` or `yes` | Allow this one time |
| `n` or `no` | Deny this request |
| `a` or `always` | Always allow this tool |

### Files Used
- `~/.claude-telegram/pending-permission.json` - Current pending permission
- `~/.claude-telegram/permission-response.json` - Your response

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
| Permission Hook | `hooks/permission-telegram.cjs` | Notifies Telegram of permission requests |
| Enter Watcher | `hooks/enter-watcher.ps1` | Sends keystrokes to Claude window |
| Message Queue | `~/.claude-telegram/queue.json` | Stores incoming messages |
| MCP Config | `.mcp.json` | Configures MCP server for Claude Code |
| Hook Config | `.claude/settings.local.json` | Configures hooks (UserPromptSubmit, PermissionRequest) |
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

