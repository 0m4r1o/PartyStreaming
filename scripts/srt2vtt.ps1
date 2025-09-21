param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path,          # .srt file OR folder
  [switch]$Recurse,       # include subfolders when Path is a folder
  [string]$OutDir,        # optional output folder (default: next to each .srt)
  [switch]$Overwrite      # overwrite existing .vtt
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

function Ensure-Dir([string]$p) {
  if ($p -and -not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function Convert-OneSrtToVtt([string]$inPath, [string]$outPath) {
  # Prefer ffmpeg (best at handling encodings)
  $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($ffmpeg) {
    # Try UTF-8 first; many .srt are cp1252 so fall back below if needed
    & ffmpeg -y -sub_charenc UTF-8 -i "$inPath" -f webvtt "$outPath" 2>$null
    if ($LASTEXITCODE -eq 0) { return }
    Warn "ffmpeg failed on $inPath (UTF-8). Trying Windows-1252..."
    & ffmpeg -y -sub_charenc WINDOWS-1252 -i "$inPath" -f webvtt "$outPath" 2>$null
    if ($LASTEXITCODE -eq 0) { return }
    Warn "ffmpeg failed again. Falling back to PowerShell converter."
  }

  # --- PowerShell fallback: quick SRT -> VTT ---
  $bytes = [System.IO.File]::ReadAllBytes($inPath)

  # Try UTF-8; if it contains replacement chars, try Windows-1252
  $s = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($s.Contains([char]0xFFFD)) {
    $enc1252 = [System.Text.Encoding]::GetEncoding(1252)
    $s = $enc1252.GetString($bytes)
  }

  # Normalize newlines
  $s = $s -replace "`r`n","`n" -replace "`r","`n"

  # Convert timestamps: 00:01:23,456 --> 00:01:25,000  =>  00:01:23.456 --> 00:01:25.000
  $s = [regex]::Replace($s, '(\d{2}:\d{2}:\d{2}),(\d{3})', '$1.$2')

  # Remove numeric index lines that precede time ranges
  $timePattern = '\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}'
  $s = [regex]::Replace($s, "(?m)^\s*\d+\s*\n(?=$timePattern)", "")

  # Ensure WEBVTT header
  if ($s -notmatch '^\s*WEBVTT') { $s = "WEBVTT`n`n$s" }

  # Write UTF-8 without BOM
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outPath, $s, $utf8NoBom)
}

# Build worklist
$items = @()
if (Test-Path -LiteralPath $Path -PathType Leaf) {
  if ([System.IO.Path]::GetExtension($Path).ToLower() -ne ".srt") {
    throw "Given file is not .srt: $Path"
  }
  $items += Get-Item -LiteralPath $Path
} elseif (Test-Path -LiteralPath $Path -PathType Container) {
  $items += Get-ChildItem -LiteralPath $Path -Filter *.srt -File -Recurse:$Recurse
} else {
  throw "Path not found: $Path"
}

if (-not $items.Count) { Warn "No .srt files found."; exit 0 }

if ($OutDir) { Ensure-Dir $OutDir }

foreach ($f in $items) {
  $dst = if ($OutDir) { Join-Path $OutDir ($f.BaseName + ".vtt") }
         else { [System.IO.Path]::ChangeExtension($f.FullName, ".vtt") }

  if (-not $Overwrite -and (Test-Path -LiteralPath $dst)) {
    Info "Skipping (exists): $dst"
    continue
  }

  Info "Converting: $($f.FullName)"
  Convert-OneSrtToVtt -inPath $f.FullName -outPath $dst
  Ok "Done -> $dst"
}

Ok "All conversions complete."
