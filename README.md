# Claude Code Telegram Plugin

Bidirectional Telegram messaging for Claude Code with remote permission control.

## Features

- **Send messages to Telegram** - Claude can send updates, progress, and results
- **Receive messages from Telegram** - Send commands to Claude remotely
- **Auto-enter** - Messages trigger Claude automatically (no manual Enter needed)
- **Remote permission control** - Approve/deny tool permissions via Telegram
- **Session-specific targeting** - Works correctly with multiple Claude windows

## Requirements

- **Windows only** (macOS/Linux support planned)
- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Your Telegram User ID

## Installation

### As a Plugin

1. Add the marketplace:
   ```
   /plugin marketplace add https://github.com/remingtonspaz/claude-code-telegram
   ```

2. Install the plugin:
   ```
   /plugin install telegram-integration:telegram
   ```

3. Install MCP server dependencies:
   ```bash
   cd ~/.claude/plugins/marketplaces/telegram-integration/mcp-server
   npm install
   ```
   On Windows: `cd %USERPROFILE%\.claude\plugins\marketplaces\telegram-integration\mcp-server`

4. Configure credentials in your project (see Setup below)

5. Restart Claude Code

### From Source

1. Clone or download this repository into your project directory
2. Run the installer:
   ```bash
   node install.js
   ```
3. Configure your Telegram credentials (see Setup below)
4. Restart Claude Code

### Manual Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   cd mcp-server && npm install
   ```
3. Create the queue directory:
   ```bash
   mkdir ~/.claude-telegram
   ```
4. Copy `.mcp.json.template` to `.mcp.json` and add your credentials
5. Configure hooks in `.claude/settings.local.json` (see Hooks Configuration below)
6. Restart Claude Code

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)

### 3. Configure Credentials

Add the MCP server to your project's `.mcp.json` with your credentials:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/path/to/claude-code-telegram/mcp-server/server.js"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your_bot_token_here",
        "TELEGRAM_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

Replace `/path/to/claude-code-telegram` with:
- **Source install:** The path where you cloned the repo (e.g., `./claude-code-telegram`)
- **Plugin install:** The plugin cache path (check `~/.claude/plugins/`)

Each project can have its own `.mcp.json` with different Telegram credentials.

### 4. Start Your Bot

Message your bot on Telegram to start the conversation. The bot can only message you if you've messaged it first.

### 5. Restart Claude Code

Restart Claude Code to load the MCP server and hooks.

### 6. Verify Installation

Run the status check to verify everything is configured:
```bash
node install.js --status
```

Or check `/mcp` in Claude Code to see if the telegram server is connected.

## Hooks Configuration

The hooks should be configured automatically if you place this plugin in your project. If not, add the following to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node path/to/hooks/telegram-context.js"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node path/to/hooks/permission-telegram.cjs"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node path/to/hooks/session-start.js"
          }
        ]
      }
    ]
  }
}
```

## Usage

### Sending Messages

Claude can send messages to you using the MCP tools:

- `telegram_send` - Send a text message
- `telegram_send_image` - Send an image file
- `telegram_check_messages` - Check for pending messages

### Receiving Messages

1. Send a message to your bot on Telegram
2. Claude receives it automatically on the next prompt
3. Messages appear in context as: `[Telegram Messages Received] ...`

### Auto-Enter Feature

When you send a Telegram message, the watcher script automatically:
1. Detects the incoming message
2. Focuses the Claude Code window
3. Sends a keystroke to trigger processing

No need to manually press Enter!

### Remote Permission Control

When Claude needs permission for a tool:

1. You receive a notification: `Permission Request - Tool: Bash`
2. Reply with:
   - `y` or `yes` - Allow once
   - `n` or `no` - Deny
   - `a` or `always` - Always allow
3. The watcher sends your response to Claude

## Project Structure

```
claude-code-telegram/
├── .claude-plugin/
│   └── plugin.json              # Plugin metadata
├── hooks/
│   ├── telegram-context.js      # Injects Telegram messages into prompts
│   ├── permission-telegram.cjs  # Sends permission requests to Telegram
│   └── session-start.js         # Auto-spawns watcher on session start
├── skills/
│   └── telegram/
│       └── SKILL.md             # Claude skill instructions
├── scripts/
│   ├── enter-watcher.ps1        # Keystroke automation (main watcher)
│   ├── list-windows.ps1         # Helper to find Claude windows
│   ├── send-enter.ps1           # Helper to send keystrokes
│   └── post-install.js          # Post-install setup script
├── mcp-server/
│   ├── server.js                # MCP server with Telegram bot
│   └── package.json             # MCP server dependencies
├── .mcp.json.template           # Credential template
├── install.js                   # Installation script
├── package.json                 # Root package.json
└── README.md
```

## Components

| Component | Purpose |
|-----------|---------|
| MCP Server | Hosts Telegram bot, exposes tools to Claude |
| UserPromptSubmit Hook | Injects Telegram messages into context |
| PermissionRequest Hook | Sends permission requests to Telegram |
| SessionStart Hook | Auto-spawns the watcher on session start |
| Enter Watcher | PowerShell script for keystroke automation |
| Skill | Guides Claude on using the integration |

## Troubleshooting

### MCP server not connecting

1. Check `/mcp` in Claude Code
2. Verify `.mcp.json` exists with valid credentials
3. Ensure `mcp-server/node_modules` exists (run `cd mcp-server && npm install`)
4. Restart Claude Code

### Messages not being received

1. Check queue file: `~/.claude-telegram/queue.json`
2. Verify bot token is valid
3. Ensure you're messaging from the authorized user ID

### Auto-enter not working

1. Check if watcher is running (look for PowerShell process)
2. Verify Claude Code is in a cmd.exe window
3. Try restarting Claude Code session

### Permission notifications not appearing

1. Ensure PermissionRequest hook is configured in `.claude/settings.local.json`
2. Check that the tool isn't already in the allow list
3. Verify Telegram bot is connected

### Check installation status

Run the diagnostic command:
```bash
node install.js --status
```

## Configuration Files

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server config with credentials (gitignored) |
| `.mcp.json.template` | Template for credentials |
| `~/.claude-telegram/queue.json` | Message queue |
| `~/.claude-telegram/pending-permission.json` | Current permission request |
| `~/.claude-telegram/permission-response.json` | Permission response |

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
