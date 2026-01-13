# Watcher script that monitors for trigger file and sends Enter to Claude Code
# Can be run manually OR auto-spawned by MCP server with target PID
#
# Usage:
#   Manual:     powershell -ExecutionPolicy Bypass -File enter-watcher.ps1
#   With PID:   powershell -ExecutionPolicy Bypass -File enter-watcher.ps1 -TargetPid 12345

param(
    [int]$TargetPid = 0,
    [string]$MatchTitle = "",
    [long]$WindowHandle = 0
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
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int processId);
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
if ($WindowHandle -gt 0) {
    Write-Host "Enter Watcher started (window handle mode: $WindowHandle)"
    # Verify handle is valid by checking if window exists
    $isValid = [Win32]::IsWindow([IntPtr]$WindowHandle)
    if (-not $isValid) {
        Write-Host "WARNING: Window handle $WindowHandle is invalid. Using search mode as fallback."
        $WindowHandle = 0
    }
} elseif ($MatchTitle -ne "") {
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
    # Check if target window/process still exists
    if ($WindowHandle -gt 0) {
        if (-not [Win32]::IsWindow([IntPtr]$WindowHandle)) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Target window closed. Switching to search mode."
            $WindowHandle = 0
        }
    } elseif ($TargetPid -gt 0) {
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
        $hwnd = [IntPtr]::Zero
        $claudeProcess = $null

        if ($WindowHandle -gt 0) {
            # Window handle mode: use the handle directly (most reliable)
            $hwnd = [IntPtr]$WindowHandle
            # Get process for AppActivate fallback
            $procId = 0
            [Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
            if ($procId -gt 0) {
                $claudeProcess = Get-Process -Id $procId -ErrorAction SilentlyContinue
            }
        } elseif ($MatchTitle -ne "") {
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

        # Get window handle from process if not already set
        if ($hwnd -eq [IntPtr]::Zero -and $claudeProcess) {
            $hwnd = $claudeProcess.MainWindowHandle
        }

        if ($hwnd -ne [IntPtr]::Zero) {
            if (-not [Win32]::IsWindow($hwnd)) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Window handle is invalid"
                continue
            }

            # Try to send keys - AppActivate method works best
            $sent = $false

            # Method 1: AppActivate (most reliable based on testing)
            if ($claudeProcess) {
                try {
                    $wshell.AppActivate($claudeProcess.Id) | Out-Null
                    Start-Sleep -Milliseconds 150
                    $wshell.SendKeys($keysToSend)
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $logMessage sent via AppActivate"
                    $sent = $true
                } catch {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] AppActivate failed: $_"
                }
            }

            # Method 2: AttachThreadInput + SetForegroundWindow (fallback)
            if (-not $sent) {
                $targetThreadId = [Win32]::GetWindowThreadProcessId($hwnd, [ref]$null)
                $currentThreadId = [Win32]::GetCurrentThreadId()
                $attached = [Win32]::AttachThreadInput($currentThreadId, $targetThreadId, $true)

                try {
                    [Win32]::ShowWindow($hwnd, 9) | Out-Null
                    [Win32]::BringWindowToTop($hwnd) | Out-Null
                    [Win32]::SetForegroundWindow($hwnd) | Out-Null
                    Start-Sleep -Milliseconds 100
                    $wshell.SendKeys($keysToSend)
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $logMessage sent via SetForegroundWindow"
                    $sent = $true
                } catch {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] SetForegroundWindow failed: $_"
                } finally {
                    if ($attached) {
                        [Win32]::AttachThreadInput($currentThreadId, $targetThreadId, $false) | Out-Null
                    }
                }
            }

            if (-not $sent) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: All methods failed to send keys"
            }
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: Claude window not found"
        }
    }

    Start-Sleep -Milliseconds 200
}
