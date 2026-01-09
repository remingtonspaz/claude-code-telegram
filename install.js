#!/usr/bin/env node
/**
 * Telegram MCP Integration Installer
 *
 * Usage:
 *   node install.js          - Full installation
 *   node install.js --status - Check installation status
 *   node install.js --help   - Show help
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUEUE_DIR = path.join(os.homedir(), '.claude-telegram');
const QUEUE_FILE = path.join(QUEUE_DIR, 'queue.json');
const MCP_SERVER_DIR = path.join(__dirname, 'mcp-server');
const HOOKS_DIR = path.join(__dirname, 'hooks');
const MCP_CONFIG = path.join(__dirname, '.mcp.json');
const SETTINGS_FILE = path.join(__dirname, '.claude', 'settings.local.json');

// Colors for console output
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function log(message, type = 'info') {
  const prefix = {
    info: colors.blue('[INFO]'),
    success: colors.green('[OK]'),
    error: colors.red('[ERROR]'),
    warn: colors.yellow('[WARN]'),
  };
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

function checkNodeVersion() {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  if (major < 18) {
    log(`Node.js version ${version} is too old. Requires >= 18.`, 'error');
    return false;
  }
  log(`Node.js version ${version}`, 'success');
  return true;
}

function checkMcpServerDeps() {
  const nodeModules = path.join(MCP_SERVER_DIR, 'node_modules');
  return fs.existsSync(nodeModules);
}

function checkQueueDir() {
  return fs.existsSync(QUEUE_DIR);
}

function checkMcpConfig() {
  return fs.existsSync(MCP_CONFIG);
}

function checkHookConfig() {
  if (!fs.existsSync(SETTINGS_FILE)) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return settings.hooks?.UserPromptSubmit?.length > 0;
  } catch {
    return false;
  }
}

function checkTelegramBot() {
  if (!fs.existsSync(MCP_CONFIG)) return { ok: false, reason: 'No .mcp.json' };
  try {
    const config = JSON.parse(fs.readFileSync(MCP_CONFIG, 'utf-8'));
    const token = config.mcpServers?.telegram?.env?.TELEGRAM_BOT_TOKEN;
    const userId = config.mcpServers?.telegram?.env?.TELEGRAM_USER_ID;
    if (!token) return { ok: false, reason: 'No bot token configured' };
    if (!userId) return { ok: false, reason: 'No user ID configured' };
    return { ok: true, token, userId };
  } catch (e) {
    return { ok: false, reason: `Config parse error: ${e.message}` };
  }
}

async function testTelegramConnection(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();
    if (data.ok) {
      return { ok: true, botName: data.result.username };
    }
    return { ok: false, reason: data.description };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function showStatus() {
  console.log(colors.bold('\n=== Telegram MCP Integration Status ===\n'));

  // Node.js version
  checkNodeVersion();

  // MCP server dependencies
  if (checkMcpServerDeps()) {
    log('MCP server dependencies installed', 'success');
  } else {
    log('MCP server dependencies not installed (run: cd mcp-server && npm install)', 'warn');
  }

  // Queue directory
  if (checkQueueDir()) {
    log(`Queue directory exists: ${QUEUE_DIR}`, 'success');
  } else {
    log(`Queue directory missing: ${QUEUE_DIR}`, 'warn');
  }

  // MCP config
  if (checkMcpConfig()) {
    log('.mcp.json configuration exists', 'success');
  } else {
    log('.mcp.json configuration missing', 'error');
  }

  // Hook config
  if (checkHookConfig()) {
    log('UserPromptSubmit hook configured', 'success');
  } else {
    log('UserPromptSubmit hook not configured', 'warn');
  }

  // Telegram bot
  const botCheck = checkTelegramBot();
  if (botCheck.ok) {
    log('Telegram credentials configured', 'success');

    // Test connection
    console.log('\nTesting Telegram connection...');
    const connTest = await testTelegramConnection(botCheck.token);
    if (connTest.ok) {
      log(`Connected to Telegram bot: @${connTest.botName}`, 'success');
    } else {
      log(`Telegram connection failed: ${connTest.reason}`, 'error');
    }
  } else {
    log(`Telegram config issue: ${botCheck.reason}`, 'error');
  }

  console.log('\n' + colors.bold('Next steps:'));
  if (!checkMcpServerDeps()) {
    console.log('  1. Run: cd mcp-server && npm install');
  }
  console.log('  2. Restart Claude Code to load the MCP server');
  console.log('  3. Check /mcp to verify server is connected');
  console.log('  4. Test with: telegram_send tool\n');
}

async function install() {
  console.log(colors.bold('\n=== Installing Telegram MCP Integration ===\n'));

  // Check Node.js version
  if (!checkNodeVersion()) {
    process.exit(1);
  }

  // Create queue directory
  if (!checkQueueDir()) {
    log(`Creating queue directory: ${QUEUE_DIR}`);
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ messages: [] }, null, 2));
    log('Queue directory created', 'success');
  } else {
    log('Queue directory already exists', 'success');
  }

  // Install MCP server dependencies
  if (!checkMcpServerDeps()) {
    log('Installing MCP server dependencies...');
    try {
      execSync('npm install', { cwd: MCP_SERVER_DIR, stdio: 'inherit' });
      log('MCP server dependencies installed', 'success');
    } catch (e) {
      log(`Failed to install dependencies: ${e.message}`, 'error');
      process.exit(1);
    }
  } else {
    log('MCP server dependencies already installed', 'success');
  }

  // Verify MCP config
  if (!checkMcpConfig()) {
    log('.mcp.json not found - please create it with your Telegram credentials', 'error');
    console.log('\nExample .mcp.json:');
    console.log(JSON.stringify({
      mcpServers: {
        telegram: {
          command: 'node',
          args: ['./mcp-server/server.js'],
          env: {
            TELEGRAM_BOT_TOKEN: 'YOUR_BOT_TOKEN',
            TELEGRAM_USER_ID: 'YOUR_USER_ID',
          },
        },
      },
    }, null, 2));
    process.exit(1);
  }
  log('.mcp.json configuration found', 'success');

  // Verify hook config
  if (!checkHookConfig()) {
    log('Hook not configured in settings.local.json', 'warn');
    log('Please ensure hooks are configured for UserPromptSubmit', 'warn');
  } else {
    log('Hook configuration found', 'success');
  }

  // Test Telegram connection
  const botCheck = checkTelegramBot();
  if (botCheck.ok) {
    console.log('\nTesting Telegram connection...');
    const connTest = await testTelegramConnection(botCheck.token);
    if (connTest.ok) {
      log(`Connected to Telegram bot: @${connTest.botName}`, 'success');
    } else {
      log(`Telegram connection test failed: ${connTest.reason}`, 'warn');
      log('The bot may still work - check your token if issues persist', 'warn');
    }
  }

  console.log(colors.bold('\n=== Installation Complete ===\n'));
  console.log('Next steps:');
  console.log('  1. Restart Claude Code to load the MCP server');
  console.log('  2. Check /mcp to verify "telegram" server is connected');
  console.log('  3. Ask Claude to send a test message to Telegram');
  console.log('  4. Send a message from Telegram, then submit a prompt to see it\n');
}

function showHelp() {
  console.log(`
${colors.bold('Telegram MCP Integration Installer')}

Usage:
  node install.js          Full installation
  node install.js --status Check installation status
  node install.js --force  Reinstall dependencies
  node install.js --help   Show this help

This installer:
  1. Creates the message queue directory (~/.claude-telegram/)
  2. Installs MCP server dependencies
  3. Verifies configuration files
  4. Tests Telegram bot connectivity
`);
}

// Main
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else if (args.includes('--status') || args.includes('-s')) {
  showStatus();
} else if (args.includes('--force') || args.includes('-f')) {
  // Force reinstall by removing node_modules first
  const nodeModules = path.join(MCP_SERVER_DIR, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    log('Removing existing node_modules...');
    fs.rmSync(nodeModules, { recursive: true, force: true });
  }
  install();
} else {
  install();
}
