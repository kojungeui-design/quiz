@echo off
setlocal
rem ============================================================
rem  Daily unattended run (for Windows Task Scheduler)
rem   PC reboots ~07:00 and BTS-600 starts with a login prompt.
rem   export_all.au3 logs in by itself, exports every circuit,
rem   then reports are generated from the CSVs.
rem  Schedule this a few minutes after boot (e.g. 07:10).
rem ============================================================

set "AUTOIT=C:\Program Files (x86)\AutoIt3\AutoIt3.exe"
if not exist "%AUTOIT%" set "AUTOIT=C:\Program Files\AutoIt3\AutoIt3.exe"
if not exist "%AUTOIT%" goto noau

rem --- wait for BTS-600 to finish starting after reboot ---
timeout /t 120 /nobreak >nul

rem --- (1) export every circuit (handles the login dialog) ---
"%AUTOIT%" "%~dp0export_all.au3"

rem --- (2) daily summary sheet ---
"%AUTOIT%" "%~dp0csv_to_report.au3"

rem --- (3) display reports for every CSV ---
"%AUTOIT%" "%~dp0make_report.au3"

echo done %date% %time%
goto end

:noau
echo [ERROR] AutoIt not found.

:end
endlocal
