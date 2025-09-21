@echo off
setlocal
if "%~1"=="" (
  echo Usage:
  echo   scripts\srt2vtt.bat "PATH\TO\file.srt"
  echo   scripts\srt2vtt.bat "PATH\TO\folder" [OutDir] [-r] [-overwrite]
  echo.
  echo Examples:
  echo   scripts\srt2vtt.bat "movies\Gladiator2.en.srt"
  echo   scripts\srt2vtt.bat "movies" "public\videos\Gladiator 2" -r -overwrite
  exit /b 1
)

set "TARGET=%~1"
set "OUTDIR=%~2"
set "FLAGS="
for %%A in (%*) do (
  if /I "%%~A"=="-r" set FLAGS=%FLAGS% -Recurse
  if /I "%%~A"=="-overwrite" set FLAGS=%FLAGS% -Overwrite
)

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0srt2vtt.ps1" -Path "%TARGET%" %FLAGS% -OutDir "%OUTDIR%"
exit /b %ERRORLEVEL%
  