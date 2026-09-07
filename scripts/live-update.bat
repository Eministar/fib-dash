@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%live-update.ps1"

if not exist "%PS_SCRIPT%" (
  echo [FEHLER] live-update.ps1 wurde nicht gefunden:
  echo   %PS_SCRIPT%
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [FEHLER] Live Update fehlgeschlagen. Exitcode %EXITCODE%
  exit /b %EXITCODE%
)

exit /b 0
