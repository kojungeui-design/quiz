@echo off
REM =====================================================================
REM  CSV 를 "측정값 표시" 엑셀로 만들기 (더블클릭 또는 CSV 끌어다놓기)
REM
REM  사용법 3가지:
REM   1) 이 bat 에 CSV 파일을 마우스로 끌어다 놓기  → 같은 폴더에 "○○ - 표시.xlsx"
REM   2) 그냥 더블클릭  → E:\bts_csv 폴더 안 모든 CSV 를 한꺼번에 처리
REM   3) 명령창:  make_report.bat  파일.csv
REM =====================================================================

REM ── 무설치 파이썬 경로 (설치형이면 그냥 python) ──
set PY=python
if exist "%~dp0python\python.exe" set PY="%~dp0python\python.exe"

set SCRIPT=%~dp0make_display_report.py

if "%~1"=="" (
    REM 인자 없으면 기본 폴더 전체 처리
    %PY% "%SCRIPT%" "E:\bts_csv"
) else (
    REM 끌어다놓은 파일들 처리
    :loop
    %PY% "%SCRIPT%" "%~1"
    shift
    if not "%~1"=="" goto loop
)

echo.
pause
