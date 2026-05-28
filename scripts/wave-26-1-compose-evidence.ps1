# scripts/wave-26-1-compose-evidence.ps1 — Diego Phase 6.1 v0.6.1.
#
# Compose the L-002 launch screenshot + an overlaid summary panel of the four
# packaged-binary export outputs (xlsx / docx / pptx / png with byte sigs) into
# a single evidence PNG at the path Marcus's brief requested.
#
# ASCII-only per the Windows fleet-deploy hard-won playbook (PS 5.1 decodes
# .ps1 as Windows-1252; non-ASCII punctuation breaks the parser).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wave-26-1-compose-evidence.ps1

param(
    [string]$LaunchShot = "$PSScriptRoot\..\release\wave-26-1-v061-launch-shot.png",
    [string]$EvidenceJson = "$PSScriptRoot\..\release\wave-26-1-v061-all-formats-evidence.json",
    [string]$OutPng = "$PSScriptRoot\..\release\wave-6-1-v061-all-formats-evidence.png"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$LaunchShot = (Resolve-Path -LiteralPath $LaunchShot).Path
$EvidenceJson = (Resolve-Path -LiteralPath $EvidenceJson).Path
$base = [System.Drawing.Image]::FromFile($LaunchShot)

$panelH = 200
$w = $base.Width
$h = $base.Height + $panelH

$canvas = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($base, 0, 0, $base.Width, $base.Height)

# Summary panel below the screenshot.
$panelTop = $base.Height
$g.FillRectangle([System.Drawing.Brushes]::Black, 0, $panelTop, $w, $panelH)
$titleFont = New-Object System.Drawing.Font 'Consolas', 13, ([System.Drawing.FontStyle]::Bold)
$monoFont = New-Object System.Drawing.Font 'Consolas', 12
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 230, 120))
$white = [System.Drawing.Brushes]::White

$json = Get-Content -LiteralPath $EvidenceJson -Raw | ConvertFrom-Json
$y = $panelTop + 10
$g.DrawString('Phase 6.1 v0.6.1 - PACKAGED-BINARY export evidence (all four formats)', $titleFont, $white, 14, $y)
$y += 28
foreach ($o in $json.outputs) {
    $valid = if ($o.valid) { 'VALID' } else { 'INVALID' }
    $line = ('  {0,-5}  {1,8} bytes  sig={2}  [{3}]' -f $o.format, $o.size, $o.signature, $valid)
    $g.DrawString($line, $monoFont, $green, 14, $y)
    $y += 24
}
$g.DrawString('Source: packaged app.asar engine + app.asar.unpacked pdfjs fonts', $monoFont, $white, 14, ($y + 4))

$canvas.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $canvas.Dispose(); $base.Dispose()
Write-Host ("Saved composite evidence: {0}" -f $OutPng)
