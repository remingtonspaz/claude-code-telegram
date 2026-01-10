# Claude Code Telegram Plugin

## Current Status: FULLY OPERATIONAL
- Bidirectional Telegram messaging: WORKING
- Auto-enter (no manual Enter needed): WORKING
- Session-specific PID targeting: WORKING
- Watcher auto-spawn: WORKING
- Permission control via Telegram: WORKING
- **Plugin structure: CONVERTED** (new)

---

## SESSION SUMMARY (2026-01-09 - Session 3)

### Plugin Conversion Complete
Converted project from standalone integration to Claude Code plugin format.

#### New Plugin Structure
```
claude-code-telegram/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── hooks/
│   ├── telegram-context.js   # UserPromptSubmit hook
│   ├── permission-telegram.cjs # PermissionRequest hook
│   └── session-start.js      # SessionStart hook (NEW)
├── skills/
│   └── telegram/
│       └── SKILL.md          # Skill file
├── scripts/
│   ├── enter-watcher.ps1     # Watcher (moved from hooks/)
│   ├── list-windows.ps1      # Helper
│   └── send-enter.ps1        # Helper
├── mcp-server/
│   └── server.js             # MCP server
├── .mcp.json.template        # Credential template (NEW)
└── README.md                 # Documentation (NEW)
```

#### Key Changes
- Created `.claude-plugin/plugin.json` with plugin metadata
- Added `SessionStart` hook to auto-spawn watcher
- Moved watcher scripts from `hooks/` to `scripts/`
- Moved skill from `.claude/skills/` to `skills/`
- Added `.mcp.json.template` for distribution
- Added comprehensive `README.md`

#### Bug Fixes
- Fixed HTML formatting in Telegram permission notifications (Buffer.byteLength vs string.length for UTF-8)

---

## Previous Sessions

### Session 2 (2026-01-09)
- Built permission control via Telegram (y/n/a responses)
- Fixed HTML tag rendering issue

### Session 1 (2026-01-09)
- Fixed watcher auto-spawn
- Added debug logging

---

## Plugin Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Session                          │
│  ┌──────────────────┐       ┌─────────────────────────────┐     │
│  │ Hooks            │       │ MCP Tools                   │     │
│  │ - UserPromptSubmit│       │ - telegram_send             │     │
│  │ - PermissionRequest│      │ - telegram_send_image       │     │
│  │ - SessionStart   │       │ - telegram_check_messages   │     │
│  └────────┬─────────┘       └─────────────┬───────────────┘     │
└───────────┼───────────────────────────────┼─────────────────────┘
            │                               │
            ▼                               ▼
     ┌──────────────┐              ┌──────────────────┐
     │ Queue File   │◄────writes───│ Telegram MCP     │
     │ queue.json   │              │ Server           │
     └──────────────┘              │ (bot listener)   │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │    Telegram      │
                                   └──────────────────┘
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Plugin Metadata | `.claude-plugin/plugin.json` | Plugin configuration |
| MCP Server | `mcp-server/server.js` | Telegram bot, MCP tools |
| Context Hook | `hooks/telegram-context.js` | Injects messages into prompts |
| Permission Hook | `hooks/permission-telegram.cjs` | Permission notifications |
| Session Hook | `hooks/session-start.js` | Auto-spawns watcher |
| Watcher Script | `scripts/enter-watcher.ps1` | Keystroke automation |
| Skill | `skills/telegram/SKILL.md` | Claude instructions |

---

## Features

### Auto-Enter
Telegram messages automatically trigger Claude - no manual Enter needed.

1. User sends message on Telegram
2. MCP server queues message, creates trigger file
3. Watcher detects trigger, sends `.` + Enter to Claude window
4. Claude processes with Telegram context injected

### Permission Control
Control Claude's permission prompts remotely via Telegram.

1. Claude requests permission → notification sent to Telegram
2. Reply: `y` (yes), `n` (no), or `a` (always)
3. Watcher sends keystroke → Claude continues

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `telegram_send` | Send text message |
| `telegram_send_image` | Send image file |
| `telegram_check_messages` | Check pending messages |

---

## Installation

### As Plugin (Recommended)
```bash
/plugin install telegram
```

### Manual
```bash
cd mcp-server && npm install
cp .mcp.json.template .mcp.json
# Edit .mcp.json with your credentials
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.mcp.json` | Credentials (gitignored) |
| `.mcp.json.template` | Template for distribution |
| `~/.claude-telegram/queue.json` | Message queue |
| `~/.claude-telegram/pending-permission.json` | Pending permission |
| `~/.claude-telegram/permission-response.json` | Permission response |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP not connecting | Check `/mcp`, verify `.mcp.json` |
| Messages not appearing | Check queue file, verify hook config |
| Watcher not running | Restart Claude Code session |
| Permission notifications broken | Check hook in settings.local.json |
