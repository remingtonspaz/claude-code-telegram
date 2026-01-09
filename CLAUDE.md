# Claude Code Telegram Bridge

## IMPORTANT: Always Forward to Telegram

**You MUST use the `telegram_send` tool to forward your responses to Telegram.** The user monitors this session remotely via Telegram and needs to see what you're doing.

After completing any task or responding to the user:
1. Summarize what you did or said
2. Call `telegram_send` with a concise summary

Keep Telegram messages concise but informative. For long responses, send a meaningful summary.

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

