#!/usr/bin/env node
/**
 * PermissionRequest Hook - Forwards permission requests to Telegram
 *
 * When Claude Code requests permission for a tool, this hook:
 * 1. Sends a notification to Telegram with tool details
 * 2. Writes pending permission info to a file
 * 3. Returns "ask" to show the normal permission prompt
 *
 * The user can then reply y/n/a on Telegram, which triggers the watcher
 * to send the appropriate keystroke.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Generate session-specific directory based on project path
// Format: ~/.claude-telegram/<basename>-<hash>/
function getSessionDir(cwd) {
    const basename = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, '_');
    const hash = crypto.createHash('md5').update(cwd).digest('hex').substring(0, 6);
    return path.join(os.homedir(), '.claude-telegram', `${basename}-${hash}`);
}

// Paths - session-specific
const SESSION_DIR = getSessionDir(process.cwd());
const PENDING_PERMISSION_PATH = path.join(SESSION_DIR, 'pending-permission.json');

// Read Telegram credentials from environment variables
function getCredentials() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const userId = process.env.TELEGRAM_USER_ID;

    if (botToken && userId) {
        return { botToken, userId };
    }

    // Fallback: try reading from .mcp.json in project directory
    try {
        const projectDir = process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..');
        const mcpConfigPath = path.join(projectDir, '.mcp.json');
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        return {
            botToken: config.mcpServers?.telegram?.env?.TELEGRAM_BOT_TOKEN,
            userId: config.mcpServers?.telegram?.env?.TELEGRAM_USER_ID
        };
    } catch (err) {
        return null;
    }
}

// Send message via Telegram Bot API
function sendTelegram(botToken, userId, message) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            chat_id: userId,
            text: message,
            parse_mode: 'HTML'
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Escape HTML special characters for Telegram
function escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Format tool info for display
function formatToolInfo(toolName, toolInput) {
    let details = '';

    if (toolName === 'Bash' && toolInput?.command) {
        details = `<code>${escapeHtml(toolInput.command)}</code>`;
    } else if (toolName === 'Edit' && toolInput?.file_path) {
        details = `File: <code>${escapeHtml(toolInput.file_path)}</code>`;
    } else if (toolName === 'Write' && toolInput?.file_path) {
        details = `File: <code>${escapeHtml(toolInput.file_path)}</code>`;
    } else if (toolName === 'Read' && toolInput?.file_path) {
        details = `File: <code>${escapeHtml(toolInput.file_path)}</code>`;
    } else if (toolInput) {
        // Generic formatting for other tools
        const keys = Object.keys(toolInput).slice(0, 3);
        details = keys.map(k => `${escapeHtml(k)}: ${escapeHtml(JSON.stringify(toolInput[k]).slice(0, 50))}`).join('\n');
    }

    return details;
}

async function main() {
    // Read input from stdin
    let input = '';
    for await (const chunk of process.stdin) {
        input += chunk;
    }

    let hookInput;
    try {
        hookInput = JSON.parse(input);
    } catch (err) {
        // If we can't parse input, just allow the normal prompt
        console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
        return;
    }

    const { tool_name, tool_input } = hookInput;

    // Get credentials
    const creds = getCredentials();
    if (!creds || !creds.botToken || !creds.userId) {
        // No credentials, fall back to normal prompt
        console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
        return;
    }

    // Ensure session directory exists
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // Write pending permission info
    const pendingInfo = {
        timestamp: new Date().toISOString(),
        tool_name,
        tool_input
    };
    fs.writeFileSync(PENDING_PERMISSION_PATH, JSON.stringify(pendingInfo, null, 2));

    // Format and send Telegram notification
    const toolDetails = formatToolInfo(tool_name, tool_input);
    const message = `🔐 <b>Permission Request</b>

<b>Tool:</b> ${escapeHtml(tool_name)}
${toolDetails ? `\n${toolDetails}\n` : ''}
Reply: <b>y</b> (yes) / <b>n</b> (no) / <b>a</b> (always)`;

    try {
        await sendTelegram(creds.botToken, creds.userId, message);
    } catch (err) {
        // Failed to send, but don't block - just show normal prompt
    }

    // Return "ask" to show the normal permission prompt
    // The watcher will handle the keystroke when user replies on Telegram
    console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
}

main().catch(() => {
    // On any error, fall back to normal behavior
    console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
});
