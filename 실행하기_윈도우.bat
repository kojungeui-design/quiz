@echo off
title Battery Catalog Collector

rem ---------------------------------------------------------------
rem  ASCII ONLY.  Do not put Korean text in this file.
rem  Korean cmd.exe reads .bat as CP949; UTF-8 Korean bytes break
rem  the parser mid-line (echo becomes ho).  All Korean output is
rem  printed by tools\run_menu.py instead, where it is safe.
rem ---------------------------------------------------------------

cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY where python3 >nul 2>&1 && set "PY=python3"
if not defined PY goto nopython

"%PY%" "%~dp0tools\run_menu.py"
goto end

:nopython
echo.
echo   [X] Python is not installed.
echo.
echo   Install it first, then run this file again:
echo     1^) Start Menu -^> Microsoft Store -^> search "Python" -^> Install
echo     2^) or https://www.python.org/downloads/
echo        During setup, CHECK "Add python.exe to PATH".
echo.

:end
echo.
pause
