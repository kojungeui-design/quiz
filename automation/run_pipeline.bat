@echo off
setlocal
rem ============================================================
rem  Full pipeline (for Task Scheduler / daily unattended run)
rem   (1) batch export : finished circuits -> E:\bts_csv (CSV)
rem   (2) make reports : CSV -> "display" Excel reports
rem ============================================================

set "OUT_DIR=E:\bts_csv"
set "SCRIPTS=%~dp0"
set "AUTOIT=C:\Program Files (x86)\AutoIt3\AutoIt3.exe"
set "PY=python"
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"

rem --- (1) batch export (AutoIt) ---
"%AUTOIT%" "%SCRIPTS%export_batch.au3"

rem --- (2) CSV -> display Excel reports (Python) ---
%PY% "%SCRIPTS%make_display_report.py" "%OUT_DIR%"

echo done %date% %time%
endlocal
