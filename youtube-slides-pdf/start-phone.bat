@echo off
rem ---------------------------------------------------------------------------
rem  YouTube slides -> PDF : phone server launcher
rem
rem  Keep this file PURE ASCII and keep the filename free of spaces and Hangul.
rem  cmd.exe parses batch files with the console code page, so Korean text here
rem  is read as mojibake and then executed as commands. All Korean messages are
rem  printed by start_server.py instead, which handles UTF-8 correctly.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"
title YouTube slides to PDF - phone server

where py >nul 2>&1 && (set PY=py) || (set PY=python)

%PY% start_server.py --port 8000
echo.
pause
