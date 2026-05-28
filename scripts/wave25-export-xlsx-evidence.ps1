# scripts/wave25-export-xlsx-evidence.ps1 - Diego Wave 25 L-002 + Phase 6 evidence.
#
# Launches v0.6.0 with a sample PDF arg, waits for window, focuses it,
# drives File menu via SendKeys to open the Export modal, captures a
# screenshot of the modal so L-002 visual verification covers BOTH the
# main window AND the new Phase 6 surface (the modal itself).
#
# ASCII-only per the Windows fleet-deploy playbook (PS 5.1 decodes .ps1
# as Windows-1252; non-ASCII punctuation breaks the parser).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wave25-export-xlsx-evidence.ps1

param(
    [string]$ExePath = "$PSScriptRoot\..\release\win-unpacked\PDF Viewer & Editor.exe",
    [string]$SamplePdf = "$PSScriptRoot\..\release\wave21-sample.pdf",
    [string]$OutPng = "$PSScriptRoot\..\release\wave-25-v060-xlsx-evidence.png",
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Continue'
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32E {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
Add-Type -TypeDefinition $signature -Language CSharp

$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
$SamplePdf = (Resolve-Path -LiteralPath $SamplePdf).Path
Write-Host ("Launching: {0} with {1}" -f $ExePath, $SamplePdf)
$proc = Start-Process -FilePath $ExePath -ArgumentList @("`"$SamplePdf`"") -PassThru
Write-Host ("Started PID {0}; waiting for window..." -f $proc.Id)

$mainWnd = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
while ([DateTime]::UtcNow -lt $deadline -and $mainWnd -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 500
    $candidates = Get-Process | Where-Object {
        $_.ProcessName -eq 'PDF Viewer & Editor' -and $_.MainWindowHandle -ne 0
    }
    if ($candidates) {
        foreach ($c in $candidates) {
            if ([Win32E]::IsWindowVisible($c.MainWindowHandle)) {
                $mainWnd = $c.MainWindowHandle
                Write-Host ("Found main window: hwnd=0x{0:X} pid={1}" -f $mainWnd.ToInt64(), $c.Id)
                break
            }
        }
    }
}

if ($mainWnd -eq [IntPtr]::Zero) {
    Write-Error 'No visible main window appeared within timeout.'
    exit 2
}

# Let renderer paint the PDF.
Start-Sleep -Seconds 4

# Focus.
$myTid = [Win32E]::GetCurrentThreadId()
$wndTid = [Win32E]::GetWindowThreadProcessId($mainWnd, [IntPtr]::Zero)
[Win32E]::AttachThreadInput($myTid, $wndTid, $true) | Out-Null
[Win32E]::ShowWindowAsync($mainWnd, 9) | Out-Null
[Win32E]::BringWindowToTop($mainWnd) | Out-Null
[Win32E]::SetForegroundWindow($mainWnd) | Out-Null
[Win32E]::AttachThreadInput($myTid, $wndTid, $false) | Out-Null
Start-Sleep -Milliseconds 500

# Drive Ctrl+Shift+E to open the Export modal (registered shortcut per Riley
# Wave 24, ui-spec section 15.2).
Write-Host 'Sending Ctrl+Shift+E to open the Export modal...'
[System.Windows.Forms.SendKeys]::SendWait('^+E')
Start-Sleep -Seconds 2

# Re-focus and capture (modal sits inside the same window).
[Win32E]::AttachThreadInput($myTid, $wndTid, $true) | Out-Null
[Win32E]::BringWindowToTop($mainWnd) | Out-Null
[Win32E]::SetForegroundWindow($mainWnd) | Out-Null
[Win32E]::AttachThreadInput($myTid, $wndTid, $false) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object Win32E+RECT
[Win32E]::GetWindowRect($mainWnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top

if ($w -le 0 -or $h -le 0) {
    Write-Error 'Window has non-positive dimensions.'
    exit 3
}

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32E]::PrintWindow($mainWnd, $hdc, 0x02)
$g.ReleaseHdc($hdc)
$g.Dispose()

if (-not $ok) { Write-Warning 'PrintWindow returned false.' }

$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("Saved screenshot: {0}" -f $OutPng)

$snap = Get-Process | Where-Object { $_.ProcessName -eq 'PDF Viewer & Editor' } | Select-Object Id, ProcessName, MainWindowTitle, HandleCount, WS, StartTime
$snap | Format-Table -AutoSize
