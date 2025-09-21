@echo off
setlocal

rem Usage:
rem   scripts\convert-hls.bat "path\to\movie.mkv" "OutputFolderName"
rem If OutputFolderName is omitted, the movie file name is used.

set IN=%~1
set NAME=%~2

if "%IN%"=="" (
  echo Usage: scripts\convert-hls.bat "path\to\movie.mkv" "OutputFolderName"
  exit /b 1
)

if "%NAME%"=="" (
  for %%F in ("%IN%") do set NAME=%%~nF
)

rem OUTDIR is projectRoot\public\videos\NAME
set OUTDIR=%~dp0..\public\videos\%NAME%

echo Input  : %IN%
echo Output : %OUTDIR%

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-media.ps1" -In "%IN%" -OutDir "%OUTDIR%" -Crf 20 -Seg 6
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo Conversion FAILED with code %ERR%.
  exit /b %ERR%
)

echo.
echo ✓ Done.
exit /b 0
