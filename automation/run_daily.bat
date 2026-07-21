@echo off
REM =====================================================================
REM 일일 자동화 배치 — Export → 엑셀 기입
REM Windows 작업 스케줄러가 매일 정해진 시간에 이 파일을 실행한다.
REM =====================================================================

set OUT_DIR=C:\bts_csv
set MODEL=GB L6
set PYDIR=C:\BTS-600\automation

REM ---- 전날 CSV 정리 ----
if exist "%OUT_DIR%\*.csv" del /q "%OUT_DIR%\*.csv"

REM ---- (1) Export 실행 ----
REM  경로 1(Btsexp 명령줄)이 가능하면 아래 주석을 풀어 사용:
REM  for /L %%i in (1,1,40) do C:\BTS-600\Btsexp.exe [인자] "%OUT_DIR%\Circ%%i.csv"
REM
REM  경로 2(AutoIt) 사용 시:
"C:\Program Files\AutoIt3\AutoIt3.exe" "%PYDIR%\export_daily.au3"

REM ---- (2) 엑셀 자동 기입 ----
REM  파이썬 설치 PC:
python "%PYDIR%\daily_report.py" "%OUT_DIR%" "%MODEL%" "%date% %time:~0,5%"

REM  (선택) 결과 엑셀을 공유폴더로 복사
REM  copy "%PYDIR%\prototype\out\daily_status.xlsx" "\\서버\공유폴더\일일현황\"

echo done %date% %time%
