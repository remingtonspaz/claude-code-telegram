#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
const QUEUE_DIR = path.join(os.homedir(), '.claude-telegram');
const QUEUE_FILE = path.join(QUEUE_DIR, 'queue.json');

// Validate configuration
if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!TELEGRAM_USER_ID) {
  console.error('TELEGRAM_USER_ID environment variable is required');
  process.exit(1);
}

// Ensure queue directory exists
if (!fs.existsSync(QUEUE_DIR)) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

// Initialize empty queue if file doesn't exist
if (!fs.existsSync(QUEUE_FILE)) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({ messages: [] }, null, 2));
}

// Initialize Telegram bot with polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Log to stderr (stdout is reserved for MCP protocol)
function log(message) {
  console.error(`[telegram-mcp] ${message}`);
}

// Find the Claude Code window PID by walking up process tree
function findClaudeWindowPid() {
  if (os.platform() !== 'win32') {
    log('Auto-watcher only supported on Windows');
    return null;
  }

  try {
    let currentPid = process.pid;

    // Walk up the process tree looking for cmd.exe
    for (let i = 0; i < 10; i++) { // Max 10 levels to prevent infinite loop
      const result = execSync(
        `wmic process where ProcessId=${currentPid} get ParentProcessId /format:value`,
        { encoding: 'utf-8', windowsHide: true }
      );

      const match = result.match(/ParentProcessId=(\d+)/);
      if (!match) break;

      const parentPid = parseInt(match[1], 10);
      if (parentPid <= 0) break;

      // Check if parent is cmd.exe
      try {
        const nameResult = execSync(
          `wmic process where ProcessId=${parentPid} get Name /format:value`,
          { encoding: 'utf-8', windowsHide: true }
        );

        if (nameResult.includes('cmd.exe')) {
          log(`Found Claude window: cmd.exe (PID: ${parentPid})`);
          return parentPid;
        }
      } catch (e) {
        // Process might not exist anymore
      }

      currentPid = parentPid;
    }

    log('Could not find cmd.exe ancestor');
    return null;
  } catch (e) {
    log(`Error finding Claude window PID: ${e.message}`);
    return null;
  }
}

// Spawn the enter watcher script with target PID
function spawnEnterWatcher(targetPid) {
  const watcherScript = path.join(__dirname, '..', 'scripts', 'enter-watcher.ps1');

  log(`Watcher script path: ${watcherScript}`);
  if (!fs.existsSync(watcherScript)) {
    log(`ERROR: Watcher script not found: ${watcherScript}`);
    return;
  }

  const args = [
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', watcherScript
  ];

  if (targetPid) {
    args.push('-TargetPid', targetPid.toString());
  }

  log(`Spawning: powershell ${args.join(' ')}`);

  try {
    const watcher = spawn('powershell', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    watcher.on('error', (err) => {
      log(`Watcher spawn error: ${err.message}`);
    });

    watcher.unref();
    log(`Spawned enter watcher (PID: ${watcher.pid}, mode: ${targetPid || 'search'})`);
  } catch (err) {
    log(`ERROR spawning watcher: ${err.message}`);
  }
}

// Auto-start the watcher on server startup
function initializeWatcher() {
  log('Starting watcher initialization...');
  const claudePid = findClaudeWindowPid();
  log(`Found Claude PID: ${claudePid}`);
  spawnEnterWatcher(claudePid);
}

// Check if a message is a permission response (y/n/a)
function isPermissionResponse(text) {
  const normalized = (text || '').trim().toLowerCase();
  return ['y', 'n', 'a', 'yes', 'no', 'always'].includes(normalized);
}

// Normalize permission response to single character
function normalizePermissionResponse(text) {
  const normalized = (text || '').trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'y') return 'y';
  if (normalized === 'no' || normalized === 'n') return 'n';
  if (normalized === 'always' || normalized === 'a') return 'a';
  return null;
}

// Check for pending permission request
function hasPendingPermission() {
  try {
    if (!fs.existsSync(PENDING_PERMISSION_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(PENDING_PERMISSION_FILE, 'utf-8'));
    // Consider pending if created within last 5 minutes
    const age = Date.now() - new Date(data.timestamp).getTime();
    return age < 5 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

// Clear pending permission
function clearPendingPermission() {
  try {
    if (fs.existsSync(PENDING_PERMISSION_FILE)) {
      fs.unlinkSync(PENDING_PERMISSION_FILE);
    }
  } catch (e) {
    log(`Error clearing pending permission: ${e.message}`);
  }
}

// Write permission response for watcher to pick up
function writePermissionResponse(response) {
  const responseData = {
    timestamp: new Date().toISOString(),
    response: response
  };
  fs.writeFileSync(PERMISSION_RESPONSE_FILE, JSON.stringify(responseData, null, 2));
  log(`Wrote permission response: ${response}`);
}

// Queue incoming messages from Telegram
bot.on('message', (msg) => {
  // Only accept messages from authorized user
  if (msg.from.id.toString() !== TELEGRAM_USER_ID) {
    log(`Ignored message from unauthorized user: ${msg.from.id}`);
    return;
  }

  const text = msg.text || '';

  // Check if this is a permission response
  if (isPermissionResponse(text) && hasPendingPermission()) {
    const response = normalizePermissionResponse(text);
    log(`Received permission response: ${text} -> ${response}`);

    // Send confirmation to user
    const responseText = response === 'y' ? 'Yes (allow once)' :
                         response === 'n' ? 'No (deny)' :
                         response === 'a' ? 'Always (allow permanently)' : text;
    bot.sendMessage(TELEGRAM_USER_ID, `✅ Permission: ${responseText}`).catch(() => {});

    // Write response for watcher
    writePermissionResponse(response);
    clearPendingPermission();

    // Trigger the watcher (it will see the permission response file)
    triggerEnterKey();
    return;
  }

  // Regular message - queue it
  const messageData = {
    id: msg.message_id,
    timestamp: Date.now(),
    text: text,
    from: msg.from.first_name || msg.from.username || 'User',
    chatId: msg.chat.id,
  };

  // Read current queue
  let queue = { messages: [] };
  try {
    const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
    queue = JSON.parse(data);
  } catch (e) {
    // Start fresh if file is corrupted
  }

  // Add message to queue
  queue.messages.push(messageData);

  // Keep only last 50 messages
  if (queue.messages.length > 50) {
    queue.messages = queue.messages.slice(-50);
  }

  // Write updated queue
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  log(`Queued message from ${messageData.from}: ${text.substring(0, 50)}...`);

  // Trigger Enter keystroke to wake up Claude Code
  triggerEnterKey();
});

// Handle polling errors
bot.on('polling_error', (error) => {
  log(`Polling error: ${error.message}`);
});

log('Telegram bot listener started');

// Trigger file for the watcher script
const TRIGGER_FILE = path.join(QUEUE_DIR, 'trigger-enter');
const PENDING_PERMISSION_FILE = path.join(QUEUE_DIR, 'pending-permission.json');
const PERMISSION_RESPONSE_FILE = path.join(QUEUE_DIR, 'permission-response.json');

// Trigger Enter keystroke by writing a trigger file (watcher script picks this up)
function triggerEnterKey() {
  // Small delay to ensure message is queued before triggering
  setTimeout(() => {
    try {
      fs.writeFileSync(TRIGGER_FILE, Date.now().toString());
      log('Wrote trigger file for Enter keystroke');
    } catch (e) {
      log(`Failed to write trigger file: ${e.message}`);
    }
  }, 500);
}

// Create MCP server
const server = new Server(
  {
    name: 'telegram-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'telegram_send',
        description: 'Send a text message to the authorized Telegram user',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message text to send',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'telegram_send_image',
        description: 'Send an image file to the authorized Telegram user',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to the image file',
            },
            caption: {
              type: 'string',
              description: 'Optional caption for the image',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'telegram_check_messages',
        description: 'Check for pending messages from Telegram and clear the queue',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'telegram_send': {
      const { message } = args;
      if (!message) {
        return {
          content: [{ type: 'text', text: 'Error: message is required' }],
          isError: true,
        };
      }

      try {
        await bot.sendMessage(TELEGRAM_USER_ID, message, { parse_mode: 'Markdown' });
        return {
          content: [{ type: 'text', text: `Message sent successfully to Telegram` }],
        };
      } catch (error) {
        // Try without markdown if it fails
        try {
          await bot.sendMessage(TELEGRAM_USER_ID, message);
          return {
            content: [{ type: 'text', text: `Message sent successfully to Telegram (plain text)` }],
          };
        } catch (retryError) {
          return {
            content: [{ type: 'text', text: `Error sending message: ${retryError.message}` }],
            isError: true,
          };
        }
      }
    }

    case 'telegram_send_image': {
      const { path: imagePath, caption } = args;
      if (!imagePath) {
        return {
          content: [{ type: 'text', text: 'Error: path is required' }],
          isError: true,
        };
      }

      if (!fs.existsSync(imagePath)) {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${imagePath}` }],
          isError: true,
        };
      }

      try {
        await bot.sendPhoto(TELEGRAM_USER_ID, imagePath, { caption: caption || '' });
        return {
          content: [{ type: 'text', text: `Image sent successfully to Telegram` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error sending image: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'telegram_check_messages': {
      try {
        let queue = { messages: [] };
        if (fs.existsSync(QUEUE_FILE)) {
          const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
          queue = JSON.parse(data);
        }

        const messages = queue.messages || [];

        // Clear the queue
        fs.writeFileSync(QUEUE_FILE, JSON.stringify({ messages: [] }, null, 2));

        if (messages.length === 0) {
          return {
            content: [{ type: 'text', text: 'No pending messages from Telegram' }],
          };
        }

        const formatted = messages
          .map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.from}: ${m.text}`)
          .join('\n');

        return {
          content: [{ type: 'text', text: `${messages.length} message(s) from Telegram:\n\n${formatted}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error reading messages: ${error.message}` }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio');

  // Auto-start the enter watcher
  initializeWatcher();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
