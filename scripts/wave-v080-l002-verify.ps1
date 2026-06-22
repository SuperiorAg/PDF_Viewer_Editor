#requires -Version 5.1
# ---------------------------------------------------------------------------
# Wave 13 (v0.8.0) L-002 PrintWindow visual capture
# Diego owns. Canonical Hard-Won Playbook §3 pattern.
#
# Steps:
#   1. Pre-flight scrub `Env:\ELECTRON_RUN_AS_NODE` (L-002 mandate).
#   2. Start-Process the unpacked exe.
#   3. Wait for window paint + helper processes (4-process Electron family).
#   4. Reposition to 1280x800 at (100,100). SetForegroundWindow + 500ms settle.
#   5. PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT=0x2) - the only flag that
#      works for Chromium GPU compositing.
#   6. Save PNG to release/smoke-v0.8.0-launch-shot.png + a process-snap txt.
#   7. Stop-Process -Force on all PIDs.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

# Step 1 — Pre-flight (L-002 mandate)
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$repoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$exePath    = Join-Path $repoRoot 'release\win-unpacked\PDF Viewer & Editor.exe'
$outDir     = Join-Path $repoRoot 'release'
$pngPath    = Join-Path $outDir 'smoke-v0.8.0-launch-shot.png'
$snapPath   = Join-Path $outDir 'smoke-v0.8.0-launch-shot.process-snap.txt'

if (-not (Test-Path -LiteralPath $exePath)) {
  Write-Error "[v080-l002] missing exe: $exePath"
  exit 1
}

Write-Host "[v080-l002] launching: $exePath"
$proc = Start-Process -FilePath $exePath -PassThru
Write-Host ('[v080-l002] launched PID {0}; waiting 6s for window + helpers to settle...' -f $proc.Id)
Start-Sleep -Seconds 6

# Step 2 — Re-resolve the main process (avoid the launcher-process disappearing race).
# electron-builder NSIS-portable's first PID can be a self-extractor; the
# actual window-owning child shows the MainWindowHandle.
$candidates = Get-Process -Name 'PDF Viewer & Editor' -ErrorAction SilentlyContinue
$main = $null
foreach ($p in $candidates) {
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    $main = $p
    break
  }
}
if ($null -eq $main) {
  # Try once more after a longer settle
  Start-Sleep -Seconds 4
  $candidates = Get-Process -Name 'PDF Viewer & Editor' -ErrorAction SilentlyContinue
  foreach ($p in $candidates) {
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $main = $p; break }
  }
}
if ($null -eq $main) {
  Write-Error '[v080-l002] no window-owning process found after 10s.'
  $candidates | ForEach-Object { Write-Host ('  cand: PID={0} hWnd={1} title={2}' -f $_.Id, $_.MainWindowHandle, $_.MainWindowTitle) }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  exit 2
}

$hWnd = $main.MainWindowHandle
Write-Host ('[v080-l002] main PID {0}, hWnd {1} (0x{2:X}), title `{3}`' -f $main.Id, $hWnd, [int64]$hWnd, $main.MainWindowTitle)

# Process-family snapshot
$family = $candidates | Sort-Object -Property Id
$snapBuilder = New-Object System.Text.StringBuilder
[void]$snapBuilder.AppendLine('# v0.8.0 launch process snapshot')
[void]$snapBuilder.AppendLine(('# captured: {0}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')))
[void]$snapBuilder.AppendLine(('# count: {0}' -f $family.Count))
foreach ($p in $family) {
  [void]$snapBuilder.AppendLine(('PID={0,-7} hWnd={1,-12} title=`{2}` startTime={3}' -f $p.Id, $p.MainWindowHandle, $p.MainWindowTitle, $p.StartTime.ToString('s')))
}
[System.IO.File]::WriteAllText($snapPath, $snapBuilder.ToString(), [System.Text.Encoding]::UTF8)
Write-Host ('[v080-l002] process snap written to {0}' -f $snapPath)

# Step 3 — Add-Type p/invoke (use -TypeDefinition with explicit using directives;
# avoids the `-MemberDefinition + -UsingNamespace` duplicate-using compile error
# noted in the v0.7.20 release ceremony).
$u32Source = @'
using System;
using System.Runtime.InteropServices;

public static class U32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}

[StructLayout(LayoutKind.Sequential)]
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
'@

if (-not ('U32' -as [type])) {
  Add-Type -TypeDefinition $u32Source -ReferencedAssemblies 'System.Runtime.InteropServices'
}

# Step 4 — Reposition + foreground + settle
$SW_RESTORE = 9
[void][U32]::ShowWindow($hWnd, $SW_RESTORE)
Start-Sleep -Milliseconds 200
[void][U32]::MoveWindow($hWnd, 100, 100, 1280, 800, $true)
Start-Sleep -Milliseconds 300
[void][U32]::SetForegroundWindow($hWnd)
Start-Sleep -Milliseconds 500

$rect = New-Object RECT
[void][U32]::GetWindowRect($hWnd, [ref] $rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host ('[v080-l002] window rect: ({0},{1})-({2},{3}) {4}x{5}; IsWindowVisible={6}; ForegroundMatches={7}' -f $rect.Left, $rect.Top, $rect.Right, $rect.Bottom, $w, $h, [U32]::IsWindowVisible($hWnd), ([U32]::GetForegroundWindow() -eq $hWnd))

if ($w -le 0 -or $h -le 0) {
  Write-Error '[v080-l002] non-positive window geometry; aborting capture.'
  Stop-Process -Id $family.Id -Force -ErrorAction SilentlyContinue
  exit 3
}

# Step 5 — PrintWindow capture (PW_RENDERFULLCONTENT = 0x2)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gr  = [System.Drawing.Graphics]::FromImage($bmp)
$dc  = $gr.GetHdc()
try {
  $PW_RENDERFULLCONTENT = 0x2
  $ok = [U32]::PrintWindow($hWnd, $dc, [uint32]$PW_RENDERFULLCONTENT)
  Write-Host ('[v080-l002] PrintWindow returned: {0}' -f $ok)
} finally {
  $gr.ReleaseHdc($dc)
  $gr.Dispose()
}
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$pngInfo = Get-Item -LiteralPath $pngPath
Write-Host ('[v080-l002] PNG saved: {0} ({1} bytes)' -f $pngPath, $pngInfo.Length)

# Step 6 — Cleanup
$ids = $family | ForEach-Object { $_.Id }
Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$residual = Get-Process -Name 'PDF Viewer & Editor' -ErrorAction SilentlyContinue
if ($residual) {
  Write-Warning ('[v080-l002] {0} residual processes after Stop-Process; force-cleanup' -f $residual.Count)
  $residual | Stop-Process -Force -ErrorAction SilentlyContinue
} else {
  Write-Host '[v080-l002] all PIDs cleanly shut down.'
}

Write-Host '[v080-l002] GREEN.'
exit 0
