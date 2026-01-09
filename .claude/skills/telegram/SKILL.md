---
name: telegram-integration
description: Set up, check status, or use the Telegram integration for Claude Code. Use this skill when the user mentions Telegram, wants to send messages to Telegram, check Telegram status, or troubleshoot Telegram connectivity. This skill should be active for ALL sessions in this project.
---

# Telegram Integration for Claude Code

This skill enables bidirectional communication with Telegram.

## IMPORTANT: Always Forward to Telegram

**You MUST use the `telegram_send` tool to forward your responses to Telegram.** The user may be monitoring this session remotely via Telegram and needs to see what you're doing.

After completing any task or responding to the user:
1. Summarize what you did or said
2. Call `telegram_send` with a concise summary

Example workflow:
```
User asks: "Fix the bug in auth.js"
You: Fix the bug, then call telegram_send with:
  "Fixed auth.js: Corrected token validation logic on line 45. The issue was an expired token check that wasn't handling edge cases."
```

For longer responses, send a meaningful summary rather than the entire response. Keep Telegram messages concise but informative.

## Quick Status Check

To verify the integration is working, check the MCP server status:
```
/mcp
```

Look for the `telegram` server in the list. If it shows as connected, the integration is active.

## Available Tools

Once the MCP server is running, you have access to these tools:

### telegram_send
Send a text message to Telegram.
```
Use the telegram_send tool with message: "Your message here"
```

### telegram_send_image
Send an image file to Telegram.
```
Use the telegram_send_image tool with path: "/absolute/path/to/image.png" and optional caption
```

### telegram_check_messages
Manually check for pending messages (messages are also auto-injected on each prompt).
```
Use the telegram_check_messages tool
```

## How It Works

1. **Outbound (Claude to Telegram)**: Call the `telegram_send` or `telegram_send_image` tools
2. **Inbound (Telegram to Claude)**: Messages are automatically injected as context before each prompt via a UserPromptSubmit hook

## Installation

If the integration isn't set up yet, run:
```bash
cd D:/Documents/ClaudeCodeRoot && node install.js
```

Then restart Claude Code to load the MCP server.

## Troubleshooting

### MCP server not showing in /mcp
1. Check that `mcp-server/node_modules` exists (run `cd mcp-server && npm install`)
2. Verify `.mcp.json` exists in the project root
3. Restart Claude Code

### Messages not being received
1. Check the queue file: `~/.claude-telegram/queue.json`
2. Verify the bot token is valid
3. Make sure you're messaging from the authorized Telegram user ID

### Send failing
1. Check the bot token in `.mcp.json`
2. Verify the user ID is correct
3. Check MCP server logs in Claude Code output

## Configuration

- Bot credentials: `.mcp.json` in project root
- Hook configuration: `.claude/settings.local.json`
- Message queue: `~/.claude-telegram/queue.json`
