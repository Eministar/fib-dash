@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

if not exist "package.json" (
  echo [FEHLER] package.json nicht gefunden. deploy.bat muss im Projektroot liegen.
  exit /b 1
)

rem Optional: Argumente durchreichen, z.B.
rem   deploy.bat -SkipDbPush
rem   deploy.bat -Seed
rem   deploy.bat -SkipInstall -SkipBuild

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo [FEHLER] Deploy fehlgeschlagen. Exitcode %EXITCODE%
  echo Aktuelles Log liegt unter deploy-logs\deploy-*.log
  exit /b %EXITCODE%
)
exit /b 0
