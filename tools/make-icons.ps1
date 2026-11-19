# Draws the Fliwyee icons (Italian tricolor with a subtitle bar) into ..\icons\
# Run with Windows PowerShell:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [single]$size
    $tile = New-RoundedPath 0 0 ($s - 0.5) ($s - 0.5) ([Math]::Max(2, $s * 0.2))
    $g.SetClip($tile)

    # tricolor
    $third = $s / 3
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 146, 70))), 0, 0, ($third + 1), $s)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 244, 245, 240))), $third, 0, ($third + 1), $s)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 206, 43, 55))), (2 * $third), 0, ($third + 1), $s)

    # subtitle bar
    $barX = $s * 0.12; $barY = $s * 0.58; $barW = $s * 0.76; $barH = $s * 0.28
    $bar = New-RoundedPath $barX $barY $barW $barH ([Math]::Max(1, $s * 0.06))
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 22, 22, 22))), $bar)

    # "text" lines inside the bar
    $lineBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $hl = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 210, 0))
    if ($size -ge 32) {
        $lh = [Math]::Max(2, $s * 0.06)
        $ly = $barY + ($barH - $lh) / 2
        $g.FillRectangle($lineBrush, ($barX + $s * 0.08), $ly, ($s * 0.2), $lh)
        $g.FillRectangle($hl, ($barX + $s * 0.32), $ly, ($s * 0.16), $lh)
        $g.FillRectangle($lineBrush, ($barX + $s * 0.52), $ly, ($s * 0.16), $lh)
    } else {
        $g.FillRectangle($hl, ($barX + $s * 0.28), ($barY + $barH * 0.38), ($s * 0.22), [Math]::Max(1.5, $s * 0.08))
    }

    $g.Dispose()
    $file = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "wrote $file"
}
