# Watcher script that monitors for trigger file and sends Enter to Claude Code
# Can be run manually OR auto-spawned by MCP server with target PID
#
# Usage:
#   Manual:     powershell -ExecutionPolicy Bypass -File enter-watcher.ps1
#   With PID:   powershell -ExecutionPolicy Bypass -File enter-watcher.ps1 -TargetPid 12345

param(
    [int]$TargetPid = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@

$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$VK_RETURN = 0x0D

$triggerFile = "$env:USERPROFILE\.claude-telegram\trigger-enter"
$triggerDir = Split-Path $triggerFile

# Ensure directory exists
if (-not (Test-Path $triggerDir)) {
    New-Item -ItemType Directory -Path $triggerDir -Force | Out-Null
}

# Clean up any existing trigger file
if (Test-Path $triggerFile) {
    Remove-Item $triggerFile -Force
}

# Create WScript.Shell for SendKeys
$wshell = New-Object -ComObject WScript.Shell

# Determine mode
if ($TargetPid -gt 0) {
    Write-Host "Enter Watcher started (PID mode: $TargetPid)"
    $targetProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $targetProcess) {
        Write-Host "ERROR: Process $TargetPid not found. Exiting."
        exit 1
    }
    Write-Host "Targeting: $($targetProcess.ProcessName) - $($targetProcess.MainWindowTitle)"
} else {
    Write-Host "Enter Watcher started (search mode)"
    Write-Host "Tip: Run with -TargetPid for specific window targeting"
}
Write-Host "Trigger file: $triggerFile"
Write-Host ""

while ($true) {
    # If targeting specific PID, check if process still exists
    if ($TargetPid -gt 0) {
        $targetProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if (-not $targetProcess) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Target process $TargetPid ended. Watcher exiting."
            exit 0
        }
    }

    if (Test-Path $triggerFile) {
        # Remove trigger file first
        Remove-Item $triggerFile -Force

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Trigger detected! Sending Enter..."

        # Find Claude Code window
        if ($TargetPid -gt 0) {
            # PID mode: target specific process
            $claudeProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        } else {
            # Search mode: find by window title pattern
            $claudeProcess = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object {
                $title = $_.MainWindowTitle
                ($title -match '^[^a-zA-Z]' -or $title -match 'claude') -and
                $title -notmatch 'npm' -and
                $title -notmatch 'powershell'
            } | Select-Object -First 1
        }

        if ($claudeProcess) {
            $hwnd = $claudeProcess.MainWindowHandle

            if ($hwnd -eq [IntPtr]::Zero) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Process found but no window handle"
                continue
            }

            # Activate window
            [Win32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
            Start-Sleep -Milliseconds 100
            [Win32]::SetForegroundWindow($hwnd) | Out-Null
            Start-Sleep -Milliseconds 200

            # Verify we have focus
            $foreground = [Win32]::GetForegroundWindow()
            if ($foreground -eq $hwnd) {
                # Type a period first (Claude ignores Enter on empty/whitespace input), then Enter
                $wshell.SendKeys(".{ENTER}")
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Period+Enter sent via WScript.Shell"
            } else {
                # Fallback: Try PostMessage directly to window
                [Win32]::PostMessage($hwnd, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]0) | Out-Null
                Start-Sleep -Milliseconds 50
                [Win32]::PostMessage($hwnd, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]0) | Out-Null
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Enter sent via PostMessage (focus failed)"
            }
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Claude window not found"
        }
    }

    Start-Sleep -Milliseconds 200
}
