# Watcher script that monitors for trigger file and sends Enter to Claude Code
# Uses PostMessage WM_CHAR for focus-independent keystroke delivery (multi-session safe)
#
# Usage:
#   Manual:     powershell -ExecutionPolicy Bypass -File enter-watcher.ps1
#   With handle: powershell -ExecutionPolicy Bypass -File enter-watcher.ps1 -WindowHandle 12345
#   With PID:   powershell -ExecutionPolicy Bypass -File enter-watcher.ps1 -TargetPid 12345

param(
    [int]$TargetPid = 0,
    [string]$MatchTitle = "",
    [long]$WindowHandle = 0,
    [string]$SessionDir = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$WM_CHAR = 0x0102
$VK_RETURN = 0x0D
$LPARAM_REPEAT_1 = [IntPtr]1
$CHAR_DELAY_MS = 20

# Determine session directory
if ($SessionDir -ne "") {
    $sessionPath = $SessionDir
} else {
    $sessionPath = "$env:USERPROFILE\.claude-telegram"
}

$triggerFile = Join-Path $sessionPath "trigger-enter"
$permissionResponseFile = Join-Path $sessionPath "permission-response.json"
$debugLog = Join-Path $sessionPath "debug.log"

# Ensure directory exists
if (-not (Test-Path $sessionPath)) {
    New-Item -ItemType Directory -Path $sessionPath -Force | Out-Null
}

# Clean up any existing trigger file
if (Test-Path $triggerFile) {
    Remove-Item $triggerFile -Force
}

function Log($msg) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$timestamp] $msg"
    Write-Host $line
    try { Add-Content -Path $debugLog -Value $line -ErrorAction SilentlyContinue } catch {}
}

# Send characters to a window handle via PostMessage WM_CHAR (no focus required)
function Send-PostMessageChars($hwnd, [string]$text) {
    foreach ($char in $text.ToCharArray()) {
        $result = [Win32]::PostMessage($hwnd, $WM_CHAR, [IntPtr][int][char]$char, $LPARAM_REPEAT_1)
        if (-not $result) {
            Log "  PostMessage failed for char '$char'"
            return $false
        }
        Start-Sleep -Milliseconds $CHAR_DELAY_MS
    }
    # Send Enter
    $result = [Win32]::PostMessage($hwnd, $WM_CHAR, [IntPtr]$VK_RETURN, $LPARAM_REPEAT_1)
    if (-not $result) {
        Log "  PostMessage failed for Enter"
        return $false
    }
    return $true
}

# Resolve window handle from parameters
function Resolve-WindowHandle {
    if ($WindowHandle -gt 0) {
        $h = [IntPtr]$WindowHandle
        if ([Win32]::IsWindow($h)) { return $h }
        Log "WARNING: Window handle $WindowHandle is invalid"
    }

    if ($TargetPid -gt 0) {
        $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            return $proc.MainWindowHandle
        }
    }

    if ($MatchTitle -ne "") {
        $proc = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowTitle -like "*$MatchTitle*"
        } | Select-Object -First 1
        if (-not $proc) {
            $proc = Get-Process -Name WindowsTerminal, powershell, pwsh -ErrorAction SilentlyContinue | Where-Object {
                $_.MainWindowTitle -like "*$MatchTitle*"
            } | Select-Object -First 1
        }
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            return $proc.MainWindowHandle
        }
    }

    # Search mode fallback
    $proc = Get-Process -Name cmd -ErrorAction SilentlyContinue | Where-Object {
        $title = $_.MainWindowTitle
        ($title -match '^[^a-zA-Z]' -or $title -match 'claude') -and
        $title -notmatch 'npm' -and
        $title -notmatch 'powershell'
    } | Select-Object -First 1
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        return $proc.MainWindowHandle
    }

    return [IntPtr]::Zero
}

# Startup logging
$hwnd = Resolve-WindowHandle
if ($hwnd -ne [IntPtr]::Zero) {
    $procId = [uint32]0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    Log "Watcher started: WindowHandle=$hwnd ProcessName=$($proc.ProcessName) PID=$procId"
} else {
    Log "Watcher started: No valid window handle yet (will resolve on trigger)"
}
Log "  SessionDir=$sessionPath"
Log "  TriggerFile=$triggerFile"
Log "  Method=PostMessage WM_CHAR (focus-independent)"

while ($true) {
    # Periodically validate window handle
    if ($hwnd -ne [IntPtr]::Zero -and -not [Win32]::IsWindow($hwnd)) {
        Log "Target window closed. Will re-resolve on next trigger."
        $hwnd = [IntPtr]::Zero
    }

    if (Test-Path $triggerFile) {
        # Remove trigger file first
        Remove-Item $triggerFile -Force

        # Determine what to send
        $charsToSend = "."
        $logMessage = "Period+Enter"

        if (Test-Path $permissionResponseFile) {
            try {
                $responseContent = Get-Content $permissionResponseFile -Raw | ConvertFrom-Json
                $response = $responseContent.response
                if ($response -eq "y" -or $response -eq "n" -or $response -eq "a") {
                    $charsToSend = $response
                    $logMessage = "Permission response: $response"
                }
                Remove-Item $permissionResponseFile -Force
            } catch {
                Log "WARNING: Failed to parse permission response"
            }
        }

        Log "Trigger detected! Sending $logMessage..."

        # Re-resolve handle if needed
        if ($hwnd -eq [IntPtr]::Zero) {
            $hwnd = Resolve-WindowHandle
        }

        if ($hwnd -ne [IntPtr]::Zero -and [Win32]::IsWindow($hwnd)) {
            $sent = Send-PostMessageChars $hwnd $charsToSend
            if ($sent) {
                Log "  Sent via PostMessage WM_CHAR (handle=$hwnd)"
            } else {
                Log "  PostMessage failed, re-resolving handle..."
                $hwnd = Resolve-WindowHandle
                if ($hwnd -ne [IntPtr]::Zero) {
                    $sent = Send-PostMessageChars $hwnd $charsToSend
                    Log "  Retry result: sent=$sent (handle=$hwnd)"
                } else {
                    Log "  WARNING: Could not resolve window handle"
                }
            }
        } else {
            Log "WARNING: No valid window handle, cannot send"
        }
    }

    Start-Sleep -Milliseconds 200
}
