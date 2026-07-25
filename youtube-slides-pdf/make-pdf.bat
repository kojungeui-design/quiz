@echo off
rem ---------------------------------------------------------------------------
rem  YouTube slides -> PDF : make a PDF right here on this PC
rem
rem  Keep this file PURE ASCII and free of spaces in its name. cmd.exe parses
rem  batch files with the console code page, so Korean text here would be read
rem  as mojibake and executed as commands. All Korean messages come from
rem  make_pdf.py, which handles UTF-8 correctly.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"
title YouTube slides to PDF

call "%~dp0find-python.bat"
if not defined PY goto :no_python

"%PY%" "%~dp0make_pdf.py" %*
echo.
pause
exit /b 0

:no_python
echo.
echo   [!] Python was not found on this PC.
echo.
echo       Install Python 3.11 or newer, then run this file again.
echo       During install, tick "Add python.exe to PATH".
echo.
echo       Opening the download page...
start "" "https://www.python.org/downloads/"
echo.
pause
exit /b 1
