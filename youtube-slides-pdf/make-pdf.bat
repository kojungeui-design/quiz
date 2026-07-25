@echo off
rem ---------------------------------------------------------------------------
rem  YouTube slides -> PDF : make a PDF right here on this PC
rem
rem  Keep this file PURE ASCII (see start-phone.bat for why). All Korean
rem  messages are printed by make_pdf.py, which handles UTF-8 correctly.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"
title YouTube slides to PDF

where py >nul 2>&1 && (set PY=py) || (set PY=python)

%PY% make_pdf.py %*
echo.
pause
