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

// Get the console window handle using Win32 API via PowerShell
// This is reliable because the hook runs in the same console as Claude Code
function getConsoleWindowHandle() {
  if (os.platform() !== 'win32') return null;

  try {
    const psScript = `
Add-Type -Name Win32 -Namespace Console -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();'
$hwnd = [Console.Win32]::GetConsoleWindow()
Write-Output $hwnd.ToInt64()
`;
    const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    });
    const hwnd = parseInt(result.trim(), 10);
    if (hwnd && hwnd > 0) {
      return hwnd;
    }
  } catch {}
  return null;
}

// Find the PID that owns a window handle
function getPidFromWindowHandle(hwnd) {
  if (!hwnd) return null;

  try {
    const psScript = `
Add-Type -Name Win32 -Namespace User32 -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'
$pid = 0
[User32.Win32]::GetWindowThreadProcessId([IntPtr]${hwnd}, [ref]$pid) | Out-Null
Write-Output $pid
`;
    const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    });
    const pid = parseInt(result.trim(), 10);
    if (pid && pid > 0) {
      return pid;
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

  // Get the console window handle - this is the most reliable method
  // since the hook runs in the same console as Claude Code
  const windowHandle = getConsoleWindowHandle();
  const targetPid = windowHandle ? getPidFromWindowHandle(windowHandle) : null;

  // Save session info for debugging
  const sessionInfo = {
    cwd: process.cwd(),
    windowHandle: windowHandle,
    targetPid: targetPid,
    timestamp: Date.now()
  };
  fs.writeFileSync(SESSION_INFO_FILE, JSON.stringify(sessionInfo, null, 2));

  const args = ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', watcherScript];

  // Prefer window handle (most reliable), fall back to PID, then search mode
  if (windowHandle) {
    args.push('-WindowHandle', windowHandle.toString());
  } else if (targetPid) {
    args.push('-TargetPid', targetPid.toString());
  }
  // If neither, watcher will use search mode

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
