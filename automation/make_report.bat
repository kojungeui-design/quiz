@echo off
setlocal
rem ============================================================
rem  Make "display" Excel report from BTS-600 CSV  (NO Python)
rem  Uses AutoIt + Excel (both already on this PC).
rem  - Drag a CSV file onto this .bat, OR
rem  - Double-click to process every CSV in E:\bts_csv
rem ============================================================

set "AUTOIT=C:\Program Files (x86)\AutoIt3\AutoIt3.exe"
if not exist "%AUTOIT%" set "AUTOIT=C:\Program Files\AutoIt3\AutoIt3.exe"
if not exist "%AUTOIT%" goto noau

"%AUTOIT%" "%~dp0make_report.au3" %*
goto done

:noau
echo.
echo [ERROR] AutoIt not found. Please install AutoIt3
echo (same tool used for auto-export).
echo.
pause

:done
endlocal
