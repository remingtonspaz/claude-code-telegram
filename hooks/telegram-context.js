#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit Hook
 *
 * This hook reads pending Telegram messages from the queue file
 * and injects them as additional context before each prompt is processed.
 * Also spawns the enter-watcher if not already running (workaround for SessionStart hook not firing).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEGRAM_DIR = path.join(os.homedir(), '.claude-telegram');
const QUEUE_FILE = path.join(TELEGRAM_DIR, 'queue.json');
const WATCHER_PID_FILE = path.join(TELEGRAM_DIR, 'watcher.pid');
const SESSION_INFO_FILE = path.join(TELEGRAM_DIR, 'session-info.json');

// Check if watcher is already running
function isWatcherRunning() {
  if (!fs.existsSync(WATCHER_PID_FILE)) return false;

  try {
    const pid = parseInt(fs.readFileSync(WATCHER_PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;

    // Check if process exists (Windows)
    if (os.platform() === 'win32') {
      try {
        const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf-8', windowsHide: true });
        // tasklist returns "INFO: No tasks..." when process doesn't exist, doesn't throw
        // Check if output contains the actual PID (not just "INFO:")
        return output.includes(pid.toString()) && !output.includes('INFO:');
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Find Claude window PID
function findClaudeWindowPid() {
  if (os.platform() !== 'win32') return null;

  try {
    let currentPid = process.pid;
    for (let i = 0; i < 10; i++) {
      const result = execSync(
        `wmic process where ProcessId=${currentPid} get ParentProcessId /format:value`,
        { encoding: 'utf-8', windowsHide: true }
      );
      const match = result.match(/ParentProcessId=(\d+)/);
      if (!match) break;

      const parentPid = parseInt(match[1], 10);
      if (parentPid <= 0) break;

      try {
        const nameResult = execSync(
          `wmic process where ProcessId=${parentPid} get Name /format:value`,
          { encoding: 'utf-8', windowsHide: true }
        );
        if (nameResult.includes('cmd.exe')) return parentPid;
      } catch {}

      currentPid = parentPid;
    }
  } catch {}
  return null;
}

// Spawn watcher if not running
function ensureWatcherRunning() {
  if (isWatcherRunning()) return;

  const watcherScript = path.join(__dirname, '..', 'scripts', 'enter-watcher.ps1');
  if (!fs.existsSync(watcherScript)) return;

  // Ensure directory exists
  if (!fs.existsSync(TELEGRAM_DIR)) fs.mkdirSync(TELEGRAM_DIR, { recursive: true });

  // Save session info for the watcher to use for window matching
  const cwd = process.cwd();
  const sessionInfo = {
    cwd: cwd,
    cwdBasename: path.basename(cwd),
    timestamp: Date.now()
  };
  fs.writeFileSync(SESSION_INFO_FILE, JSON.stringify(sessionInfo, null, 2));

  const args = ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', watcherScript];
  // Pass the cwd basename for window title matching (more reliable than PID)
  args.push('-MatchTitle', sessionInfo.cwdBasename);

  try {
    const watcher = spawn('powershell', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    // Save PID for future checks
    fs.writeFileSync(WATCHER_PID_FILE, watcher.pid.toString());

    watcher.unref();
  } catch {}
}

async function main() {
  // Ensure watcher is running (workaround for SessionStart hook not firing)
  ensureWatcherRunning();

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
