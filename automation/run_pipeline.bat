@echo off
REM =====================================================================
REM  전체 파이프라인 (Windows)
REM   (1) 배치 export : 완료된 회로 → E:\bts_csv 에 CSV
REM   (2) CSV 정리    : CSV → 관리대장(일일 시험현황) 엑셀
REM  작업 스케줄러가 매일/매시 이 파일을 실행하면 무인 운영.
REM =====================================================================

set OUT_DIR=E:\bts_csv
set SCRIPTS=C:\bts_auto
set AUTOIT="C:\Program Files (x86)\AutoIt3\AutoIt3.exe"
set PY=python
set MODEL=GB L6

REM ---- (1) 배치 export (AutoIt) ----
%AUTOIT% "%SCRIPTS%\export_batch.au3"

REM ---- (2) CSV -> 관리대장 정리 (Python) ----
%PY% "%SCRIPTS%\daily_report.py" "%OUT_DIR%" "%MODEL%" "%date% %time:~0,5%"

REM ---- (선택) 결과 엑셀을 공유폴더로 복사 ----
REM copy "%SCRIPTS%\out\daily_status.xlsx" "\\서버\공유\일일현황\daily_%date:~0,10%.xlsx"

echo done %date% %time%
