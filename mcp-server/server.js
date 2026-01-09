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

// Queue incoming messages from Telegram
bot.on('message', (msg) => {
  // Only accept messages from authorized user
  if (msg.from.id.toString() !== TELEGRAM_USER_ID) {
    log(`Ignored message from unauthorized user: ${msg.from.id}`);
    return;
  }

  const messageData = {
    id: msg.message_id,
    timestamp: Date.now(),
    text: msg.text || '',
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
  log(`Queued message from ${messageData.from}: ${messageData.text.substring(0, 50)}...`);
});

// Handle polling errors
bot.on('polling_error', (error) => {
  log(`Polling error: ${error.message}`);
});

log('Telegram bot listener started');

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
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
