# scripts/wave21-launch-shot.ps1 — Diego Wave 21 L-002 screenshot capture.
#
# Launches the packaged v0.5.0 binary, waits for the main window to appear,
# brings it to the foreground, then captures the screen region containing
# the window via System.Drawing.Graphics.CopyFromScreen — the same PowerShell
# pattern documented in .learnings/locked-instructions.md L-002 and used in
# Wave 17 (`release/wave17-v040-launch-shot-full.png`).
#
# ASCII-only per the Windows fleet-deploy hard-won playbook (PS 5.1 decodes
# .ps1 as Windows-1252; non-ASCII punctuation breaks the parser).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wave21-launch-shot.ps1

param(
    [string]$ExePath = "$PSScriptRoot\..\release\win-unpacked\PDF Viewer & Editor.exe",
    [string]$OutPng  = "$PSScriptRoot\..\release\wave21-v050-launch-shot.png",
    [int]$WaitSeconds = 12,
    [string]$PdfPath = ""
)

$ErrorActionPreference = 'Continue'

# Pre-flight environment hygiene (L-002 hard requirement).
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Win32 interop for window discovery + PrintWindow capture.
# PrintWindow asks the window to render into a DC we provide; works in
# non-interactive (session-less) PowerShell shells where CopyFromScreen
# returns "handle is invalid" because the running thread has no attached
# desktop. PrintWindow + PW_RENDERFULLCONTENT (0x02) renders DWM-composited
# Chromium content correctly on Electron 30+ / Chromium 124+.
$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
Add-Type -TypeDefinition $signature -Language CSharp

$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
Write-Host ("Launching: {0}" -f $ExePath)
if ($PdfPath -ne "") {
    $PdfPath = (Resolve-Path -LiteralPath $PdfPath).Path
    Write-Host ("With PDF arg: {0}" -f $PdfPath)
    $proc = Start-Process -FilePath $ExePath -ArgumentList @("`"$PdfPath`"") -PassThru
} else {
    $proc = Start-Process -FilePath $ExePath -PassThru
}
Write-Host ("Started PID {0}; waiting up to {1}s for window..." -f $proc.Id, $WaitSeconds)

# Poll for a top-level window owned by the Electron family.
$mainWnd = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
while ([DateTime]::UtcNow -lt $deadline -and $mainWnd -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 500
    $candidates = Get-Process | Where-Object {
        $_.ProcessName -eq 'PDF Viewer & Editor' -and $_.MainWindowHandle -ne 0
    }
    if ($candidates) {
        foreach ($c in $candidates) {
            if ([Win32]::IsWindowVisible($c.MainWindowHandle)) {
                $mainWnd = $c.MainWindowHandle
                Write-Host ("Found main window: hwnd=0x{0:X} pid={1}" -f $mainWnd.ToInt64(), $c.Id)
                break
            }
        }
    }
}

if ($mainWnd -eq [IntPtr]::Zero) {
    Write-Error 'No visible main window appeared within the timeout.'
    exit 2
}

# Allow renderer first paint to complete before grabbing the bitmap.
Start-Sleep -Seconds 2

# AttachThreadInput to bypass SetForegroundWindow restrictions.
$myTid = [Win32]::GetCurrentThreadId()
$wndTid = [Win32]::GetWindowThreadProcessId($mainWnd, [IntPtr]::Zero)
[Win32]::AttachThreadInput($myTid, $wndTid, $true) | Out-Null
[Win32]::ShowWindowAsync($mainWnd, 9) | Out-Null   # SW_RESTORE
[Win32]::BringWindowToTop($mainWnd) | Out-Null
[Win32]::SetForegroundWindow($mainWnd) | Out-Null
[Win32]::AttachThreadInput($myTid, $wndTid, $false) | Out-Null
Start-Sleep -Milliseconds 750

# Read window rect + capture full screen region containing the window.
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($mainWnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host ("Window rect: left={0} top={1} right={2} bottom={3} ({4}x{5})" -f $rect.Left, $rect.Top, $rect.Right, $rect.Bottom, $w, $h)

if ($w -le 0 -or $h -le 0) {
    Write-Error 'Window has non-positive dimensions; capture aborted.'
    exit 3
}

# PrintWindow path — works in non-interactive shells unlike CopyFromScreen,
# which fails with "handle is invalid" when the running thread has no
# attached desktop (the typical agent-shell case). PW_RENDERFULLCONTENT
# (0x02) tells DWM to render the actual composited Chromium content
# rather than a transparent placeholder, which is required on Electron
# 30+ / Chromium 124+.
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32]::PrintWindow($mainWnd, $hdc, 0x02)
$g.ReleaseHdc($hdc)
$g.Dispose()

if (-not $ok) {
    Write-Warning 'PrintWindow returned false; bitmap may be incomplete.'
}

$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("Saved screenshot: {0}" -f $OutPng)

# Capture process metadata as the floor-not-ceiling sanity check.
$snap = Get-Process | Where-Object { $_.ProcessName -eq 'PDF Viewer & Editor' } | Select-Object Id, ProcessName, MainWindowTitle, HandleCount, WS, StartTime
$snap | Format-Table -AutoSize
$snapPath = [System.IO.Path]::ChangeExtension($OutPng, '.process-snap.txt')
$snap | Out-File -FilePath $snapPath -Encoding utf8
Write-Host ("Saved process snapshot: {0}" -f $snapPath)
