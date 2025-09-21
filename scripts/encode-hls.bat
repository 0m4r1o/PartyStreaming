@echo off
setlocal enabledelayedexpansion
if "%~1"=="" (
  echo Usage: scripts\encode-hls.bat input.mp4 outputName
  exit /b 1
)
set IN=%~1
set NAME=%~2
if "%NAME%"=="" set NAME=family
set OUT=public\videos\%NAME%
mkdir "%OUT%" 2>nul

REM Simple HLS encode to be broadly compatible
ffmpeg -y -i "%IN%" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 160k -f hls -hls_time 6 -hls_list_size 0 -hls_segment_filename "%OUT%/segment%%03d.ts" "%OUT%/playlist.m3u8"

echo Done: /%OUT%/playlist.m3u8