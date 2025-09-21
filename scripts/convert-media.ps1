# scripts/convert-media.ps1
# ASCII-only to avoid codepage issues on Windows PowerShell.

param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$Crf = 20,
  [int]$Seg = 6
)

$ErrorActionPreference = 'Stop'

# --- helpers ---------------------------------------------------------------
function Resolve-InputPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  if ([System.IO.Path]::IsPathRooted($p)) {
    try { return (Resolve-Path -LiteralPath $p -ErrorAction Stop).Path } catch { return $null }
  }
  try { return (Resolve-Path -LiteralPath $p -ErrorAction Stop).Path } catch {}
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $root = Resolve-Path (Join-Path $scriptDir "..")
  $cands = @(
    (Join-Path $root $p),
    (Join-Path $root "movies\$p"),
    (Join-Path (Get-Location) $p)
  )
  foreach ($c in $cands) { try { return (Resolve-Path -LiteralPath $c -ErrorAction Stop).Path } catch {} }
  return $null
}

function Ensure-Dir([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  return (Resolve-Path $dir).Path
}

function Get-AudioMapArg([string]$inPath) {
  try {
    $json = & ffprobe -v error -select_streams a -show_entries stream=index:stream_tags=language -of json "$inPath" 2>$null
    if (-not $json) { return "0:a:0?" }
    $obj = $json | ConvertFrom-Json
    $streams = @($obj.streams)
    if (-not $streams -or $streams.Count -eq 0) { return "0:a:0?" }

    $targetPos = 0
    for ($i=0; $i -lt $streams.Count; $i++) {
      $lang = ""
      if ($streams[$i].tags -and $streams[$i].tags.language) {
        $lang = ($streams[$i].tags.language | Out-String).Trim().ToLower()
      }
      if ($lang -match "^(en|eng)\b") { $targetPos = $i; break }
    }
    return "0:a:$targetPos?"
  } catch {
    return "0:a:0?"
  }
}

# --- resolve paths ---------------------------------------------------------
$ResolvedIn  = Resolve-InputPath $In
if (-not $ResolvedIn) {
  Write-Host ""
  Write-Error "Input not found: $In
Hints:
  - Check the exact file name (dir .\unconverted\*.mkv)
  - Keep quotes around paths with spaces
  - Or pass a full absolute path like C:\Videos\Movie.mkv"
  exit 1
}

$OutDir = Ensure-Dir $OutDir
$playlist = Join-Path $OutDir "playlist.m3u8"
$segTpl   = Join-Path $OutDir "segment%03d.ts"

# Clean any partial outputs from a previous failed run
if (Test-Path $playlist) { Remove-Item $playlist -Force -ErrorAction SilentlyContinue }
Get-ChildItem -LiteralPath $OutDir -Filter "segment*.ts" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Input     : $ResolvedIn"
Write-Host "Output dir: $OutDir"
Write-Host "CRF       : $Crf, Segments: ${Seg}s, Audio: 160k"

# Choose audio stream position (english-first if present)
$audioMap = Get-AudioMapArg $ResolvedIn
Write-Host "Audio map : $audioMap (english-first if present)"

# --- ffmpeg command (EVENT playlist, start at 0, stable audio/PTS) ----------
$ffArgs = @(
  "-y",
  "-hide_banner",
  "-loglevel","info",
  "-stats",
  "-fflags","+genpts",
  "-i",$ResolvedIn,
  "-map","0:v:0",
  "-map",$audioMap,
  "-sn","-dn",
  "-c:v","libx264",
  "-pix_fmt","yuv420p",
  "-preset","veryfast",
  "-crf","$Crf",
  "-profile:v","high",
  "-level","" + "4.0",
  "-g","60",
  "-keyint_min","60",
  "-sc_threshold","0",
  "-c:a","aac",
  "-ac","2",
  "-ar","48000",
  "-b:a","160k",
  "-af","aresample=async=1:first_pts=0",
  "-max_delay","0",
  "-muxdelay","0",
  "-muxpreload","0",
  "-f","hls",
  "-hls_time","$Seg",
  "-hls_list_size","0",
  "-hls_flags","independent_segments+append_list",
  "-hls_playlist_type","event",
  "-start_number","0",
  "-hls_segment_type","mpegts",
  "-hls_segment_filename",$segTpl,
  $playlist
)

Write-Host "[INFO] Encode HLS (EVENT)"
Write-Host ("ffmpeg " + ($ffArgs -join " "))

# Use call operator so the array is passed correctly
& ffmpeg @ffArgs
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg failed (Encode HLS), ExitCode=$LASTEXITCODE"
}

Write-Host "[OK] Done."
exit 0
