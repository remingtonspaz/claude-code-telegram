#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit Hook
 *
 * This hook reads pending Telegram messages from the queue file
 * and injects them as additional context before each prompt is processed.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const QUEUE_FILE = path.join(os.homedir(), '.claude-telegram', 'queue.json');

async function main() {
  // Read input from stdin (Claude Code sends hook input as JSON)
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  // Parse input (though we don't need it for this hook)
  try {
    JSON.parse(input);
  } catch (e) {
    // Input might be empty or invalid, that's okay
  }

  // Check if queue file exists
  if (!fs.existsSync(QUEUE_FILE)) {
    // No queue file, nothing to inject
    process.exit(0);
  }

  // Read the queue
  let queue;
  try {
    const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
    queue = JSON.parse(data);
  } catch (e) {
    // Can't read queue, exit silently
    process.exit(0);
  }

  const messages = queue.messages || [];

  // If no messages, exit without output
  if (messages.length === 0) {
    process.exit(0);
  }

  // Format messages for context injection
  const formattedMessages = messages
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleTimeString();
      return `[${time}] ${m.from}: ${m.text}`;
    })
    .join('\n');

  const contextText = `[Telegram Messages Received]\n${formattedMessages}\n[End Telegram Messages]`;

  // Clear the queue after reading
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ messages: [] }, null, 2));
  } catch (e) {
    // Failed to clear queue, continue anyway
  }

  // Output the context injection response
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: contextText,
    },
  };

  console.log(JSON.stringify(output));
  process.exit(0);
}

main().catch((error) => {
  console.error(`Hook error: ${error.message}`);
  process.exit(1);
});
