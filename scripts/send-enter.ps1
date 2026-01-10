# Send Enter keystroke to Claude Code console window
Add-Type -AssemblyName System.Windows.Forms

# Get all processes with window titles
$processes = Get-Process | Where-Object { $_.MainWindowTitle -ne '' }

# Find the Claude Code window specifically (window title is exactly "claude")
$claudeProcess = $processes | Where-Object { $_.MainWindowTitle -eq 'claude' } | Select-Object -First 1

if ($claudeProcess) {
    # Use SetForegroundWindow API for more reliable activation
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
"@

    $hwnd = $claudeProcess.MainWindowHandle
    [Win32]::ShowWindow($hwnd, 9) # SW_RESTORE
    Start-Sleep -Milliseconds 50
    [Win32]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}
