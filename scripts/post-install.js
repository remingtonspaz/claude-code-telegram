#!/usr/bin/env node
/**
 * Post-install script for Claude Code Telegram Plugin
 *
 * Automatically runs after plugin installation to:
 * 1. Install MCP server dependencies
 * 2. Create queue directory
 * 3. Copy credential template if needed
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.join(__dirname, '..');

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function log(message, type = 'info') {
  const prefix = {
    info: colors.blue('[telegram]'),
    success: colors.green('[telegram]'),
    error: colors.red('[telegram]'),
    warn: colors.yellow('[telegram]'),
  };
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

async function main() {
  log('Running post-install setup...', 'info');

  // 1. Install MCP server dependencies
  const mcpServerDir = path.join(PLUGIN_ROOT, 'mcp-server');
  const nodeModules = path.join(mcpServerDir, 'node_modules');

  if (!fs.existsSync(nodeModules)) {
    log('Installing MCP server dependencies...', 'info');
    try {
      execSync('npm install', {
        cwd: mcpServerDir,
        stdio: 'inherit'
      });
      log('Dependencies installed', 'success');
    } catch (e) {
      log(`Failed to install dependencies: ${e.message}`, 'error');
      log('Run manually: cd mcp-server && npm install', 'warn');
    }
  } else {
    log('Dependencies already installed', 'success');
  }

  // 2. Create queue directory
  const queueDir = path.join(os.homedir(), '.claude-telegram');
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
    fs.writeFileSync(
      path.join(queueDir, 'queue.json'),
      JSON.stringify({ messages: [] }, null, 2)
    );
    log('Created queue directory', 'success');
  }

  // 3. Check for credentials
  const mcpConfig = path.join(PLUGIN_ROOT, '.mcp.json');
  const mcpTemplate = path.join(PLUGIN_ROOT, '.mcp.json.template');

  if (!fs.existsSync(mcpConfig) && fs.existsSync(mcpTemplate)) {
    log('Credentials not configured', 'warn');
    console.log('');
    console.log(colors.bold('Next steps:'));
    console.log('  1. Copy the template:');
    console.log(`     cp "${mcpTemplate}" "${mcpConfig}"`);
    console.log('  2. Edit .mcp.json with your Telegram credentials:');
    console.log('     - TELEGRAM_BOT_TOKEN: Get from @BotFather');
    console.log('     - TELEGRAM_USER_ID: Get from @userinfobot');
    console.log('  3. Restart Claude Code');
    console.log('');
  } else if (fs.existsSync(mcpConfig)) {
    log('Credentials configured', 'success');
  }

  log('Post-install complete!', 'success');
}

main().catch((err) => {
  log(`Post-install error: ${err.message}`, 'error');
  process.exit(1);
});
