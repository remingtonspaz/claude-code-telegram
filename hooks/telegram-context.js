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
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate session-specific directory based on project path
// Format: ~/.claude-telegram/<basename>-<hash>/
function getSessionDir(cwd) {
  const basename = path.basename(cwd).replace(/[^a-zA-Z0-9-_]/g, '_');
  const hash = crypto.createHash('md5').update(cwd).digest('hex').substring(0, 6);
  return path.join(os.homedir(), '.claude-telegram', `${basename}-${hash}`);
}

const SESSION_DIR = getSessionDir(process.cwd());
const QUEUE_FILE = path.join(SESSION_DIR, 'queue.json');
const WATCHER_PID_FILE = path.join(SESSION_DIR, 'watcher.pid');
const SESSION_INFO_FILE = path.join(SESSION_DIR, 'session-info.json');

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

// Walk up process tree using WMIC to find cmd.exe ancestor
// Returns { pid, hwnd } or null
function findCmdAncestor() {
  if (os.platform() !== 'win32') return null;

  try {
    let currentPid = process.pid;

    for (let i = 0; i < 15; i++) {
      // Get parent PID using WMIC
      let parentPid;
      try {
        const result = execSync(
          `wmic process where ProcessId=${currentPid} get ParentProcessId /format:value`,
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        );
        const match = result.match(/ParentProcessId=(\d+)/);
        if (!match) break;
        parentPid = parseInt(match[1], 10);
        if (parentPid <= 0) break;
      } catch {
        break;
      }

      // Check if parent is cmd.exe
      try {
        const nameResult = execSync(
          `wmic process where ProcessId=${parentPid} get Name /format:value`,
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        );

        if (nameResult.includes('cmd.exe')) {
          // Found cmd.exe! Now get its window handle using PowerShell
          try {
            const hwndResult = execSync(
              `powershell -NoProfile -Command "(Get-Process -Id ${parentPid}).MainWindowHandle.ToInt64()"`,
              { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
            );
            const hwnd = parseInt(hwndResult.trim(), 10);
            return { pid: parentPid, hwnd: hwnd > 0 ? hwnd : null };
          } catch {
            return { pid: parentPid, hwnd: null };
          }
        }
      } catch {
        // Process might not exist, continue
      }

      currentPid = parentPid;
    }
  } catch (e) {
    try {
      fs.appendFileSync(path.join(SESSION_DIR, 'debug.log'),
        `[${new Date().toISOString()}] findCmdAncestor error: ${e.message}\n`);
    } catch {}
  }
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
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  // Find cmd.exe ancestor in process tree
  const cmdInfo = findCmdAncestor();

  // Save session info for debugging
  const sessionInfo = {
    cwd: process.cwd(),
    sessionDir: SESSION_DIR,
    hookPid: process.pid,
    cmdPid: cmdInfo?.pid || null,
    windowHandle: cmdInfo?.hwnd || null,
    timestamp: Date.now()
  };
  fs.writeFileSync(SESSION_INFO_FILE, JSON.stringify(sessionInfo, null, 2));

  // Build watcher arguments - always pass session directory
  const watcherArgs = ['-SessionDir', SESSION_DIR.replace(/\\/g, '/')];
  if (cmdInfo?.hwnd) {
    watcherArgs.push('-WindowHandle', cmdInfo.hwnd.toString());
  } else if (cmdInfo?.pid) {
    watcherArgs.push('-TargetPid', cmdInfo.pid.toString());
  }

  // Use Start-Process to spawn a truly detached background process
  // This is more reliable on Windows than Node's spawn with detached
  const startProcessCmd = `Start-Process -FilePath 'powershell' -ArgumentList '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', '${watcherScript.replace(/'/g, "''")}' ${watcherArgs.map(a => `, '${a}'`).join('')} -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id`;

  try {
    const result = execSync(`powershell -NoProfile -Command "${startProcessCmd}"`, {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 10000
    });
    const watcherPid = parseInt(result.trim(), 10);
    if (watcherPid > 0) {
      fs.writeFileSync(WATCHER_PID_FILE, watcherPid.toString());
    }
  } catch (e) {
    // Log error for debugging
    try {
      fs.appendFileSync(path.join(SESSION_DIR, 'debug.log'),
        `[${new Date().toISOString()}] Watcher spawn error: ${e.message}\n`);
    } catch {}
  }
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
      let content = '';
      if (m.imagePath) {
        content += `[Image: ${m.imagePath}]`;
        if (m.text) content += ` ${m.text}`;
      } else {
        content = m.text;
      }
      return `[${time}] ${m.from}: ${content}`;
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
