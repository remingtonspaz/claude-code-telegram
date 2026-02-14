# Claude Code Telegram Plugin

## Current Status: FULLY OPERATIONAL
- Bidirectional Telegram messaging: WORKING
- Auto-enter (no manual Enter needed): WORKING
- Session-specific PID targeting: WORKING
- Watcher auto-spawn: WORKING
- Permission control via Telegram: WORKING
- **Plugin structure: CONVERTED** (new)

---

## SESSION SUMMARY (2026-01-13 - Session 4)

### Watcher Auto-Spawn & Keystroke Delivery Fixes
Major debugging session to fix watcher auto-spawn and reliable keystroke delivery.

#### Problems Solved

1. **SessionStart hook not firing** (Claude Code bug)
   - Moved watcher spawn logic into `UserPromptSubmit` hook as workaround
   - Watcher now spawns on first prompt instead of session start

2. **Watcher process dying immediately**
   - Node.js `spawn()` with `detached: true` unreliable on Windows
   - Fixed by using PowerShell `Start-Process` for proper background process

3. **isWatcherRunning() false positive**
   - `tasklist` doesn't throw error when no process matches
   - Fixed to check output for "INFO:" message

4. **Process tree walking failures**
   - PowerShell script syntax errors when newlines replaced with spaces
   - Fixed by using incremental WMIC calls (same as session-start.js)

5. **Focus/keystroke delivery failing**
   - `SetForegroundWindow` blocked by Windows focus-stealing prevention
   - Fixed by using `AppActivate` as primary method (works reliably)

6. **Multiple Claude windows targeting wrong window**
   - Search mode would find first matching window
   - Fixed by walking process tree from hook to find correct cmd.exe ancestor

#### Key Technical Changes

- `telegram-context.js`: Added `findCmdAncestor()` using WMIC to reliably find parent cmd.exe
- `telegram-context.js`: Use `Start-Process` via PowerShell for watcher spawn
- `enter-watcher.ps1`: Prioritize `AppActivate` over `SetForegroundWindow`
- `enter-watcher.ps1`: Fall back to search mode if PID invalid (handles race conditions)
- `enter-watcher.ps1`: Added `AttachThreadInput` as secondary focus method

#### New Debug Files

| File | Purpose |
|------|---------|
| `~/.claude-telegram/session-info.json` | Debug: hookPid, cmdPid, windowHandle |
| `~/.claude-telegram/watcher.pid` | Tracks spawned watcher process |
| `~/.claude-telegram/debug.log` | Error logging |

---

## Previous Sessions

### Session 3 (2026-01-09)
Plugin conversion - converted from standalone to plugin format.

### Session 2 (2026-01-09)
Built permission control via Telegram (y/n/a responses).

### Session 1 (2026-01-09)
Initial watcher auto-spawn and debug logging.

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
| MCP Server (source) | `mcp-server/server.js` | Telegram bot, MCP tools |
| MCP Server (bundle) | `mcp-server/dist/server.js` | Bundled server (what `.mcp.json` points to) |
| Context Hook | `hooks/telegram-context.js` | Injects messages + spawns watcher |
| Permission Hook | `hooks/permission-telegram.cjs` | Permission notifications |
| Session Hook | `hooks/session-start.js` | (Unused - SessionStart hook bug) |
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
cd mcp-server && npm install && npm run build
cp .mcp.json.template .mcp.json
# Edit .mcp.json with your credentials
```

---

## Configuration Files

### Credentials (choose one)

| Method | Location | Purpose |
|--------|----------|---------|
| Per-project | `<project>/.claude/telegram.json` | Project-specific credentials (priority) |
| Global | `.mcp.json` env vars | Default credentials for all projects |

**Per-project config** (`<project>/.claude/telegram.json`):
```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "userId": "YOUR_USER_ID"
}
```

The server checks for `.claude/telegram.json` first, then falls back to environment variables from `.mcp.json`.

### Other Files

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server config + fallback credentials |
| `.mcp.json.template` | Template for distribution |

### Session-Specific Files

Each Claude Code session has its own folder: `~/.claude-telegram/<project>-<hash>/`

Example: `D:\Projects\my-app` → `~/.claude-telegram/my-app-a1b2c3/`

| File | Purpose |
|------|---------|
| `queue.json` | Message queue |
| `trigger-enter` | Trigger file for watcher |
| `pending-permission.json` | Pending permission |
| `permission-response.json` | Permission response |
| `watcher.pid` | Watcher process ID |
| `session-info.json` | Debug: session/window info |
| `debug.log` | Error logging |

---

## Development Workflow

The MCP server is bundled into a single file using esbuild. This eliminates the need for `npm install` at runtime — all dependencies are baked into `mcp-server/dist/server.js`.

### After editing `mcp-server/server.js`:
```bash
cd mcp-server && npm run build
```
Then restart the MCP server in Claude Code (`/mcp` → restart telegram).

### Why bundling?
- `.mcp.json` points to `dist/server.js`, not `server.js`
- No `node_modules` needed at runtime (3 MB bundle vs 46 MB node_modules)
- `npm install` is only needed for development (adding/updating dependencies)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP not connecting | Check `/mcp`, verify `.mcp.json` |
| Messages not appearing | Check queue file, verify hook config |
| Watcher not running | Check `watcher.pid`, verify process exists |
| Watcher dies immediately | Check `debug.log` for errors |
| Keystrokes to wrong window | Verify `session-info.json` has correct `cmdPid` |
| Permission notifications broken | Check hook in settings.local.json |

### Debug Commands

```powershell
# List all session folders
Get-ChildItem "$env:USERPROFILE\.claude-telegram" -Directory

# Check session info (replace <session-folder> with actual folder name)
Get-Content "$env:USERPROFILE\.claude-telegram\<session-folder>\session-info.json"

# Check watcher status
$pid = Get-Content "$env:USERPROFILE\.claude-telegram\<session-folder>\watcher.pid"
Get-Process -Id $pid -ErrorAction SilentlyContinue

# Check for errors
Get-Content "$env:USERPROFILE\.claude-telegram\<session-folder>\debug.log"

# List all cmd.exe windows (for multiple window debugging)
Get-Process -Name cmd | ForEach-Object {
    Write-Host "PID: $($_.Id) | Title: '$($_.MainWindowTitle)'"
}
```
