@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title 배터리 카달로그 수집기

echo.
echo ==========================================
echo    배터리 카달로그 수집기
echo ==========================================
echo.

cd /d "%~dp0"

rem ── 1. 파이썬 찾기 ─────────────────────────────────────────────
set PY=
where py > nul 2>&1 && set PY=py
if "!PY!"=="" (where python > nul 2>&1 && set PY=python)
if "!PY!"=="" (where python3 > nul 2>&1 && set PY=python3)

if "!PY!"=="" (
  echo [X] 파이썬이 없습니다.
  echo.
  echo     설치 방법 ^(둘 중 아무거나^)
  echo       1^) 시작 메뉴 -^> Microsoft Store -^> "Python" 검색 -^> 설치
  echo       2^) https://www.python.org/downloads/ 에서 받기
  echo          ** 설치 화면에서 "Add python.exe to PATH" 를 꼭 체크 **
  echo.
  echo     설치한 다음 이 파일을 다시 더블클릭하세요.
  echo.
  pause
  exit /b 1
)
echo [1/3] 파이썬 확인:
!PY! --version
echo.

rem ── 2. 필요한 부품 설치 ────────────────────────────────────────
echo [2/3] 필요한 부품을 설치합니다 ^(처음 한 번만 오래 걸립니다^)...
!PY! -m pip install --quiet --user --upgrade pip           > nul 2>&1
!PY! -m pip install --quiet --user requests pypdf openpyxl
if errorlevel 1 (
  echo.
  echo [X] 설치가 실패했습니다. 회사 네트워크가 막고 있을 수 있습니다.
  echo     아래를 그대로 복사해서 명령 프롬프트에 넣어보세요.
  echo     ^(회사 프록시 주소는 IT 팀에 물어보면 알려줍니다^)
  echo.
  echo       !PY! -m pip install --user --proxy http://프록시주소:포트 requests pypdf openpyxl
  echo.
  pause
  exit /b 1
)
echo      완료.
echo.

rem ── 3. 무엇을 할지 고르기 ──────────────────────────────────────
echo [3/3] 무엇을 할까요?
echo.
echo    1  주소가 살아있는지만 확인 ^(1분, 아무것도 안 받음^)  ^<-- 처음엔 이것부터
echo    2  카달로그 전체 수집 ^(수십 분^)
echo    3  PDF 만 수집 ^(빠름^)
echo    4  유통사 사이트에서 경쟁 브랜드 찾기
echo    0  그냥 나가기
echo.
set /p SEL="번호를 넣고 엔터: "

if "%SEL%"=="1" (
  !PY! tools\collect.py --dry
  goto done
)
if "%SEL%"=="2" (
  !PY! tools\collect.py
  goto done
)
if "%SEL%"=="3" (
  !PY! tools\collect.py --types pdf
  goto done
)
if "%SEL%"=="4" (
  !PY! tools\collect.py --brands
  goto done
)
if "%SEL%"=="0" exit /b 0

echo 1, 2, 3, 4, 0 중에서 골라주세요.
pause
exit /b 1

:done
echo.
echo ==========================================
echo  끝났습니다.
echo.
echo  결과는 catalogs 폴더 안에 있습니다:
echo    collect_log.csv        어느 주소가 되고 안 됐는지
echo    collected_models.csv   뽑아낸 스펙  -^> 앱에 올릴 파일
echo    catalog_registry.csv   근거 ^(파일명, SHA-256, 페이지수^)
echo ==========================================
echo.
pause
