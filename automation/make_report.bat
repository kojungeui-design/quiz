@echo off
setlocal
rem ============================================================
rem  Make "display" Excel report from BTS-600 CSV
rem  - Drag a CSV file onto this .bat, OR
rem  - Double-click to process every CSV in E:\bts_csv
rem ============================================================

set "PY=python"
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"
set "SCRIPT=%~dp0make_display_report.py"

rem --- check Python is available ---
%PY% --version >nul 2>&1
if errorlevel 1 goto nopy

if "%~1"=="" goto folder

rem --- files were dragged onto this bat ---
:loop
echo Processing "%~1"
%PY% "%SCRIPT%" "%~1"
shift
if not "%~1"=="" goto loop
goto done

rem --- no file dragged: process the whole folder ---
:folder
echo Processing folder E:\bts_csv
%PY% "%SCRIPT%" "E:\bts_csv"
goto done

:nopy
echo.
echo [ERROR] Python was not found on this PC.
echo Please install Python 3 and run:  pip install openpyxl
echo (or ask your administrator)
echo.

:done
echo.
echo Done. Press any key to close.
pause >nul
endlocal
