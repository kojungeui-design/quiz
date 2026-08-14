@echo off
REM ---------------------------------------------------------------
REM  Battery Design Studio v8 - build
REM
REM  This file is intentionally ASCII-only.
REM  cmd.exe reads .bat files using the system codepage (949 on Korean
REM  Windows), so Korean text inside a UTF-8 .bat gets garbled.
REM  All Korean messages are printed by node instead, which handles
REM  UTF-8 correctly once chcp 65001 is set below.
REM ---------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js not found.
  echo          Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node tools/release.mjs %*
set EXITCODE=%ERRORLEVEL%

echo.
pause
exit /b %EXITCODE%
