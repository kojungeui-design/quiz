---
name: bts600-automation
description: >
  Digatron BTS-600 배터리 시험기 데이터 자동화. BTS-600 CSV(Measuring data list)
  추출, 관리대장 요약, "측정값 표시" 엑셀 리포트(핵심 측정지점 노란색 표시) 생성에
  사용. 시험 종류(용량/RC, 수명/DoD, CCA 냉간시동)별 표시 규칙과 파이썬 없는
  AutoIt+Excel 방식 포함. "BTS-600", "Digatron", "관리대장", "측정값 표시",
  "CCA", "C20", "냉간시동", "배터리 시험 CSV" 등이 나오면 사용.
---

# BTS-600 배터리 시험 데이터 자동화

세방전지 시험실의 Digatron BTS-600(Windows 7, V1.600.395, 회로 120개)에서 나오는
시험 데이터를 자동으로 정리한다. 실제 구현은 이 저장소 `automation/` 폴더에 있다.

## 장비/데이터 핵심 사실 (반드시 기억)

- **Export는 GUI 전용.** 명령줄/배치/DDE 자동화 없음(매뉴얼로 확인). 데이터는 장비
  내부 바이너리(.DAS/.DAT). CSV는 Export 대화상자(내부적으로 Btsexp.exe)로만 생성,
  **한 번에 한 test section**.
- **CSV 형식** = "Measuring data list": 메타 블록(Battery ID, Program, Circuit,
  Test section, Start/End of test) + 데이터 헤더 + 단위행([V],[A],…) + 데이터행.
- **데이터 컬럼**: Step, Status, Time, Step time, Program time, Cycle, Cycle level,
  Procedure, Voltage, Current, 그리고 Ah 4종(AhStep/AhCha/AhDch/AhAccu).
  ⚠️ **Ah 컬럼 순서가 파일마다 다름**(일반 시험 vs CCA). 항상 **컬럼 이름으로** 인덱스 찾기.
- **상태 코드**: `CHA`=충전, `DCH`=방전, `PAU`=휴지, `STO`=정지. `Step 9999`=종료 마커.
- BTS는 **스텝 경계에서 같은 값 행을 한 줄 더** 찍는다(중복행). 표시 위치가 ±1행
  달라질 수 있고 값은 동일 — 문제 아님.

## 두 갈래 산출물

- **① 진행현황 관리대장**: 회로당 1행 요약(상태·전압·충/방전용량·사이클). 매일 현황 파악.
  → `csv_to_report.au3` (순수 AutoIt, 파이썬 불필요). 출력 `_report.csv`(UTF-8 BOM).
- **② 측정값 표시 엑셀**: CSV 원본을 **값 그대로** 엑셀로 옮기고 핵심 측정지점만
  노란색(ARGB `FFFFFF00`) 표시. 요약이 아니라 원본이라 값이 정확.
  → 파이썬판 `make_display_report.py`(openpyxl), 무설치판 `make_report.au3`(AutoIt+Excel COM).

## 표시(노란색) 규칙 — 시험 종류 자동 판별

우선순위대로 판별한다:

1. **최대 |전류| > 100A → CCA(냉간시동)**
2. 아니고 **최대 Cycle ≥ 2 → 수명/반복(DoD 등)**
3. 그 외 → **단일시험(용량/RC/충전수입성 등)**

정의: 스텝 번호가 연속으로 같은 구간 = "블록". `hasData` = AhAccu 필드가 비어있지 않음.
Step time은 실수 초로 파싱(0.1초 로깅 대응).

- **단일시험**: 블록 분할 → 앞쪽 PAU(대기) 블록 제거 → 뒤쪽 STO/9999 제거 →
  **첫 시험블록 시작 + 각 블록의 마지막 행** 표시. (충·방전·휴지 완료점)
- **수명/반복**: 각 사이클의 **마지막 DCH 행**을 찾아, `cycle % N == 0`(기본 N=5)인
  사이클만 표시. (예: DoD "5cyc반복")
- **CCA**: DCH 블록을 순서대로. **첫 DCH(크랭킹)** = 시작 + Step time **5·10·30초**에
  가장 가까운(0.6초 이내, 데이터 있는) 행 + 블록 마지막(데이터 있는) 행.
  **이후 DCH(지구력)** = 마지막(데이터 있는) 행만. EN=2단(10s펄스+지구력), SAE=단일(~53s).

검증 결과: 0C20·0RC·ENCCA1 = 수기 표시본과 **정확 일치**. 1C20/1RC/RC/ENCCA2 = 중복행·초기값
때문에 ±1행 차이(값 동일). J2801은 파일명에 있으면 **자동 제외**.

## 파일 지도 (`automation/`)

| 파일 | 역할 |
|---|---|
| `export_batch.au3` | 완료 회로 배치 자동 Export(크래시 감지·재시도, 파일명=내용 보정) |
| `export_circuit.au3` | 회로 1개 Export (인자: 회로번호 행index) |
| `capture_coords.au3` | 좌표(영점) 안전 캡처 — Finder Tool 대체 |
| `csv_to_report.au3` | ① 관리대장 요약 (파이썬 X) |
| `make_display_report.py` | ② 표시 엑셀 (Python/openpyxl) |
| `make_report.au3` + `.bat` | ② 표시 엑셀 (AutoIt+Excel, **무설치**) |
| `run_pipeline.bat` | 전체 파이프라인 (스케줄러용) |
| `report_guide.md`, `README.md`, `deploy_windows.md`, `scheduler_setup.md` | 문서 |
| `담당자_따라하기_가이드/*.html` | 시험실 담당자용 초간단 그림 가이드 |

전체 상세 기록은 `automation/BTS600_AUTOMATION.md` 참고.

## 함정과 교훈 (재현 시 반드시)

- **BTS-600에서 AutoIt "Window Info(Finder Tool)"를 절대 쓰지 말 것** — 장비가
  General Protection Fault로 죽는다. 좌표는 전체화면 스크린샷/`capture_coords.au3`로 얻는다.
- **`.bat`는 순수 ASCII + CRLF.** 한글 주석은 한국어 윈도우(CP949)에서 명령으로
  잘못 실행됨. `if ( )` 괄호블록 대신 `goto` 라벨 사용(LF 줄바꿈 파싱 오류 회피).
- **AutoIt 변수는 대소문자 무시** — `$OUT`(경로)와 `$out`(내용)이 충돌. 이름 구분.
- **AutoIt 한글 파일명 저장 실패** 가능 → AutoIt 산출물은 영문명(`_report.csv`) 사용.
  (Excel COM SaveAs는 한글 경로 OK)
- **Windows용 zip은 한글 파일명에 UTF-8 플래그(0x800) 필수** — 없으면 압축해제 시
  한글 이름 파일이 사라짐. Python `zipfile`로 `ZipInfo.flag_bits |= 0x800`.
- **파이썬 미설치 PC**: 무설치는 `make_report.au3`(AutoIt+Excel COM). 임베디드 파이썬은
  python.org/github 정책 차단으로 이 환경에선 못 받음. Excel COM: `SaveAs(path, 51)`=xlsx,
  `Interior.Color = 65535`=노란색(BGR).
- **완료 시점 예측 금지** — 계속 바뀜. 상태가 STO로 바뀌는 것으로 완료 감지.
- 미해결: export 클릭 좌표 "영점" 정밀 재보정, 완전 무인(완료 자동감지).

## 재현 방법

1. `automation/BTS600_AUTOMATION.md`로 전체 맥락 파악.
2. CSV 예시로 `make_display_report.py <파일>` 실행 → 표시 규칙 확인.
3. 새 시험 종류가 나오면: 원본 CSV + 사용자의 수기 표시본(xlsx)을 받아
   노란 행을 역분석 → 위 규칙 프레임에 새 분기 추가 → 예시로 검증(EXACT 목표).
4. 배포는 무설치판(AutoIt+Excel) 우선. 담당자에겐 `담당자_따라하기_가이드` HTML 전달.
