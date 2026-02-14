#!/usr/bin/env node
/**
 * PermissionRequest Hook - Forwards permission requests to Telegram
 *
 * Detects different prompt types and formats them appropriately:
 * - AskUserQuestion: Shows the question with numbered options
 * - ExitPlanMode: Shows plan approval prompt
 * - EnterPlanMode: Shows plan mode entry prompt
 * - Regular tools: Shows permission request with y/n/a
 *
 * The user can then reply on Telegram, which triggers the watcher
 * to send the appropriate keystroke.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Generate session-specific directory based on project path
function getSessionDir(cwd) {
    const basename = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, '_');
    const hash = crypto.createHash('md5').update(cwd).digest('hex').substring(0, 6);
    return path.join(os.homedir(), '.claude-telegram', `${basename}-${hash}`);
}

const SESSION_DIR = getSessionDir(process.cwd());
const PENDING_PERMISSION_PATH = path.join(SESSION_DIR, 'pending-permission.json');

// Read Telegram credentials from multiple sources
function getCredentials() {
    // 1. Try project-specific config first
    try {
        const configPath = path.join(process.cwd(), '.claude', 'telegram.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.botToken && config.userId) {
                return { botToken: config.botToken, userId: config.userId.toString() };
            }
        }
    } catch (err) {}

    // 2. Try environment variables
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const userId = process.env.TELEGRAM_USER_ID;
    if (botToken && userId) return { botToken, userId };

    // 3. Fallback: .mcp.json
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
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Format AskUserQuestion prompt
function formatAskUserQuestion(toolInput) {
    const questions = toolInput?.questions || [];
    if (questions.length === 0) return null;

    let message = `\u2753 <b>Claude has a question</b>\n`;

    for (const q of questions) {
        message += `\n<b>${escapeHtml(q.question)}</b>\n`;

        const options = q.options || [];
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            message += `\n<b>${i + 1}.</b> ${escapeHtml(opt.label)}`;
            if (opt.description) {
                message += `\n    <i>${escapeHtml(opt.description)}</i>`;
            }
        }
        // "Other" is always available
        message += `\n<b>${options.length + 1}.</b> Other (custom text)`;

        if (q.multiSelect) {
            message += `\n\n<i>(Multi-select: reply with comma-separated numbers)</i>`;
        }
    }

    message += `\n\nReply with <b>number</b> to select, or <b>y</b> to approve`;
    return message;
}

// Format ExitPlanMode prompt
function formatExitPlanMode(toolInput) {
    let message = `\u{1F4CB} <b>Plan Ready for Review</b>\n`;
    message += `\nClaude has finished planning and wants your approval to proceed.`;
    message += `\n\nReply: <b>y</b> (approve) / <b>n</b> (reject)`;
    return message;
}

// Format EnterPlanMode prompt
function formatEnterPlanMode(toolInput) {
    let message = `\u{1F4DD} <b>Enter Plan Mode?</b>\n`;
    message += `\nClaude wants to switch to planning mode to design an approach before implementing.`;
    message += `\n\nReply: <b>y</b> (approve) / <b>n</b> (reject)`;
    return message;
}

// Format regular tool permission request
function formatToolPermission(toolName, toolInput) {
    let details = '';

    if (toolName === 'Bash' && toolInput?.command) {
        details = `<code>${escapeHtml(toolInput.command)}</code>`;
    } else if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') && toolInput?.file_path) {
        details = `File: <code>${escapeHtml(toolInput.file_path)}</code>`;
    } else if (toolInput) {
        const keys = Object.keys(toolInput).slice(0, 3);
        details = keys.map(k => `${escapeHtml(k)}: ${escapeHtml(JSON.stringify(toolInput[k]).slice(0, 80))}`).join('\n');
    }

    let message = `\u{1F510} <b>Permission Request</b>\n`;
    message += `\n<b>Tool:</b> ${escapeHtml(toolName)}`;
    if (details) message += `\n${details}`;
    message += `\n\nReply: <b>y</b> (yes) / <b>n</b> (no) / <b>a</b> (always)`;
    return message;
}

// Detect prompt type and format message accordingly
function formatMessage(toolName, toolInput) {
    switch (toolName) {
        case 'AskUserQuestion':
            return formatAskUserQuestion(toolInput) || formatToolPermission(toolName, toolInput);
        case 'ExitPlanMode':
            return formatExitPlanMode(toolInput);
        case 'EnterPlanMode':
            return formatEnterPlanMode(toolInput);
        default:
            return formatToolPermission(toolName, toolInput);
    }
}

async function main() {
    let input = '';
    for await (const chunk of process.stdin) {
        input += chunk;
    }

    let hookInput;
    try {
        hookInput = JSON.parse(input);
    } catch (err) {
        console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
        return;
    }

    const { tool_name, tool_input } = hookInput;

    const creds = getCredentials();
    if (!creds || !creds.botToken || !creds.userId) {
        console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
        return;
    }

    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // Write pending info with prompt type for the watcher/MCP server
    const pendingInfo = {
        timestamp: new Date().toISOString(),
        tool_name,
        tool_input,
        prompt_type: tool_name === 'AskUserQuestion' ? 'question'
            : tool_name === 'ExitPlanMode' ? 'plan_approval'
            : tool_name === 'EnterPlanMode' ? 'plan_entry'
            : 'permission'
    };
    fs.writeFileSync(PENDING_PERMISSION_PATH, JSON.stringify(pendingInfo, null, 2));

    const message = formatMessage(tool_name, tool_input);

    try {
        await sendTelegram(creds.botToken, creds.userId, message);
    } catch (err) {
        // Failed to send, don't block
    }

    // Auto-approve AskUserQuestion so the question UI appears immediately
    // The user will select their option via Telegram (watcher sends number key)
    if (tool_name === 'AskUserQuestion') {
        console.log(JSON.stringify({ decision: { behavior: 'allow' } }));
    } else {
        console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
    }
}

main().catch(() => {
    console.log(JSON.stringify({ decision: { behavior: 'ask' } }));
});
