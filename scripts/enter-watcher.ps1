# Watcher script that monitors for trigger file and sends Enter to Claude Code
# Can be run manually OR auto-spawned by MCP server with target PID
#
# Usage:
#   Manual:     powershell -ExecutionPolicy Bypass -File enter-watcher.ps1
#   With PID:   powershell -ExecutionPolicy Bypass -File enter-watcher.ps1 -TargetPid 12345

param(
    [int]$TargetPid = 0,
    [string]$MatchTitle = ""
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
$permissionResponseFile = "$env:USERPROFILE\.claude-telegram\permission-response.json"
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
if ($MatchTitle -ne "") {
    Write-Host "Enter Watcher started (title match mode: '$MatchTitle')"
} elseif ($TargetPid -gt 0) {
    Write-Host "Enter Watcher started (PID mode: $TargetPid)"
    $targetProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $targetProcess) {
        Write-Host "WARNING: Process $TargetPid not found. Using search mode as fallback."
        $TargetPid = 0
    } else {
        Write-Host "Targeting: $($targetProcess.ProcessName) - $($targetProcess.MainWindowTitle)"
    }
} else {
    Write-Host "Enter Watcher started (search mode)"
}
Write-Host "Trigger file: $triggerFile"
Write-Host ""

while ($true) {
    # If targeting specific PID, check if process still exists
    if ($TargetPid -gt 0) {
        $targetProcess = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if (-not $targetProcess) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Target process $TargetPid ended. Switching to search mode."
            $TargetPid = 0
        }
    }

    if (Test-Path $triggerFile) {
        # Remove trigger file first
        Remove-Item $triggerFile -Force

        # Check if this is a permission response or a regular message trigger
        $keysToSend = ".{ENTER}"
        $logMessage = "Period+Enter"

        if (Test-Path $permissionResponseFile) {
            try {
                $responseContent = Get-Content $permissionResponseFile -Raw | ConvertFrom-Json
                $response = $responseContent.response
                if ($response -eq "y" -or $response -eq "n" -or $response -eq "a") {
                    $keysToSend = "$response{ENTER}"
                    $logMessage = "Permission response: $response"
                }
                # Remove the permission response file
                Remove-Item $permissionResponseFile -Force
            } catch {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Failed to parse permission response"
            }
        }

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Trigger detected! Sending $logMessage..."

        # Find Claude Code window
        if ($MatchTitle -ne "") {
            # Title match mode: find cmd window whose title contains the match string
            $claudeProcess = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object {
                $_.MainWindowTitle -like "*$MatchTitle*"
            } | Select-Object -First 1

            if (-not $claudeProcess) {
                # Fallback: try WindowsTerminal or other terminals
                $claudeProcess = Get-Process -Name WindowsTerminal, powershell, pwsh -ErrorAction SilentlyContinue | Where-Object {
                    $_.MainWindowTitle -like "*$MatchTitle*"
                } | Select-Object -First 1
            }
        } elseif ($TargetPid -gt 0) {
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

            # Try multiple times to activate and send keys
            $sent = $false
            for ($attempt = 1; $attempt -le 3; $attempt++) {
                # Activate window with multiple methods
                [Win32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
                Start-Sleep -Milliseconds 50
                [Win32]::ShowWindow($hwnd, 5) | Out-Null  # SW_SHOW
                Start-Sleep -Milliseconds 50
                [Win32]::SetForegroundWindow($hwnd) | Out-Null
                Start-Sleep -Milliseconds 150

                # Also try AppActivate by process ID
                try {
                    $wshell.AppActivate($claudeProcess.Id) | Out-Null
                    Start-Sleep -Milliseconds 100
                } catch {}

                # Verify we have focus
                $foreground = [Win32]::GetForegroundWindow()
                if ($foreground -eq $hwnd) {
                    $wshell.SendKeys($keysToSend)
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $logMessage sent via SendKeys (attempt $attempt)"
                    $sent = $true
                    break
                }

                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Focus attempt $attempt failed, retrying..."
                Start-Sleep -Milliseconds 200
            }

            if (-not $sent) {
                # Final fallback: use AppActivate + SendKeys without focus check
                try {
                    $wshell.AppActivate($claudeProcess.Id) | Out-Null
                    Start-Sleep -Milliseconds 200
                    $wshell.SendKeys($keysToSend)
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $logMessage sent via AppActivate fallback"
                    $sent = $true
                } catch {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: All focus methods failed"
                }
            }
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Claude window not found"
        }
    }

    Start-Sleep -Milliseconds 200
}
