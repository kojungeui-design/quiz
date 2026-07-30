# BTS-600 시험 데이터 자동화 — 전체 기록 (핸드북)

세방전지 시험실 · Digatron BTS-600 (Windows 7, V1.600.395, 회로 120개)
데이터 추출 → 정리 → 리포트 자동화의 전체 배경·결정·구현·검증 기록.
"처음부터 다시" 할 때 이 문서 하나로 맥락을 복원할 수 있게 작성함.

---

## 1. 목표

시험기에서 사람이 하나씩 눌러 내보내던 과정을 자동화하고, 두 갈래로 정리한다.

```
Digatron BTS-600 (회로 120개, 시험 진행)
   │  ← 사람이 GUI에서 회로마다 Export 해야 CSV가 나옴 (하루 일감이 큼)
[① 자동 추출: AutoIt]  export_batch.au3
   │
CSV 파일 (E:\bts_csv)   "Measuring data list" 형식
   ├─ ① 진행현황 관리대장   csv_to_report.au3   (매일 현황 파악)
   └─ ② 측정값 표시 엑셀    make_report.au3 / make_display_report.py
                            (원본 값 + 핵심 측정지점 노란색 표시)
[④ 무인 운영(선택)]  run_pipeline.bat + 작업 스케줄러
```

---

## 2. 장비/데이터 조사 결과 (매뉴얼 + 화면 분석)

- **Export는 GUI 전용.** BTS-600 매뉴얼(HTML 풀버전 + PDF) 확인 결과 명령줄/배치/DDE
  자동화 수단 없음. 원본은 장비 내부 바이너리(.DAS/.DAT/.DAH, Digatron 전용).
  CSV는 Export 대화상자(내부 `Btsexp.exe`)로만 생성, **한 번에 한 test section**.
  → 결론: 단순 파일복사 불가, **GUI 자동화(AutoIt)** 로 Export 자동 실행이 유일한 길.
- **데이터 저장 위치**: `C:\BTS-600\Environ\BATTERY\BATT00NN\<시험구간>\`
- **CSV 구조** ("Measuring data list"):
  - 메타 블록: `Measuring data list <BattID>, <TestSection>` / Date/Time / Battery ID /
    Program / Circuit / Test section / Start of test / End of test …
  - 데이터 헤더: `Step, Status, Time, Step time, Program time, Cycle, Cycle level,
    Procedure, Voltage, Current, [Ah 4종]`
  - 단위행: `[V],[A],[AhStep],[AhCha],[AhDch],[Ah]` 등
  - 데이터행: 위 순서대로
- **⚠️ Ah 컬럼 순서가 파일마다 다름**:
  - 일반 시험: `… AhStep, AhCha, AhDch, AhAccu`
  - CCA 시험:  `… AhAccu, AhCha, AhDch, AhStep`
  - → 코드는 **항상 컬럼 이름으로** 인덱스를 찾을 것.
- **상태 코드**: `CHA`=충전, `DCH`=방전, `PAU`=휴지, `STO`=정지. `Step 9999`=종료 마커.
- **중복행**: BTS는 스텝 경계에서 같은 값 행을 한 줄 더 기록. 표시 위치 ±1행 차이의 원인
  (값은 동일).

---

## 3. 산출물 ① — 진행현황 관리대장

- 파일: `csv_to_report.au3` (**순수 AutoIt, 파이썬 불필요**)
- 동작: `E:\bts_csv` 의 모든 CSV → 회로당 1행 요약
  (시료·회로·시험구간·프로그램·상태·경과h·현재전압·충전용량·방전용량·사이클)
- 출력: `E:\bts_csv\_report.csv` (**UTF-8 BOM**, 엑셀에서 한글 안 깨짐)
- 파일명이 아니라 **CSV 안의 Battery ID를 읽음** → 이름이 틀려도 정확.

---

## 4. 산출물 ② — "측정값 표시" 엑셀 (핵심)

CSV 원본을 **값 그대로** 엑셀로 옮기고, 핵심 측정지점 행만 노란색(`FFFFFF00`)으로 표시.
요약이 아니라 원본이라 값이 정확(기존 요약이 "너무 간단·값 불확실"하던 문제 해결).

- 파이썬판: `make_display_report.py` (openpyxl). 별도 PC/서버 대량처리용.
- 무설치판: `make_report.au3` + `make_report.bat` (AutoIt이 계산, Excel COM이 색칠·저장).

### 4.1 표시(노란색) 규칙 — 시험 종류 자동 판별

우선순위:
1. **최대 |Current| > 100A → CCA(냉간시동)**
2. 아니고 **최대 Cycle ≥ 2 → 수명/반복**
3. 그 외 → **단일시험**

용어: "블록" = Step 번호가 연속으로 같은 구간. `hasData` = AhAccu 필드 비어있지 않음.
Step time은 실수 초로 파싱(`HH:MM:SS.ff`, 0.1초 로깅 대응).

- **단일시험(용량/RC/충전수입성 등)**
  블록 분할 → 앞쪽 `PAU`(대기) 블록 제거 → 뒤쪽 `STO`/`9999` 제거 →
  **첫 시험블록 시작** + **각 블록의 마지막 행** 표시.
  (= 방전 시작 / 충·방전·휴지 완료점)

- **수명/반복(DoD 등)**
  각 사이클의 **마지막 DCH 행**을 구해, `cycle % N == 0`(기본 N=5)인 사이클만 표시.
  `--cyc N` 으로 간격 조정. (DoD "5cyc반복" 대응)

- **CCA(냉간시동)**
  DCH 블록을 순서대로:
  - **첫 DCH(크랭킹)**: 시작 행 + Step time **5·10·30초**에 가장 가까운(0.6초 이내,
    데이터 있는) 행 + 블록 마지막(데이터 있는) 행.
  - **이후 DCH(지구력)**: 마지막(데이터 있는) 행만.
  - EN CCA = 2단(−760A 10초 펄스 + −444A 지구력→컷오프), SAE CCA = 단일(−690A ~53초→컷오프).

- **J2801**: 파일명에 `J2801` 있으면 **자동 제외**(요청).

### 4.2 검증 결과 (사용자 수기 표시본과 대조)

| 시험 | 종류 | 결과 |
|---|---|---|
| 0C20, 0RC | 단일 | **EXACT ✓** |
| 1C20, 1RC, 0C20-RC | 단일 | ±1행(중복행/초기값, 값 동일) |
| dod 17.5%, dod 50% | 수명 | 5cyc 간격 표시(사용자는 예시 2개만 수기) |
| ENCCA1 | CCA | **EXACT ✓** (시작·5s·10s·지구력종료) |
| ENCCA2 | CCA | ±1행(크랭킹 시작 중복행, 값 동일) |
| SAECCA1 | CCA | 참조본 없이 0/5/10/30초 + 방전종료(53s, 7.2V) 추출 |
| J2801 | (제외) | 스킵 |

데이터 정확도: 원본 CSV 대비 값 불일치 **0건**(전 행·전 값 그대로).

### 4.3 Excel COM 메모 (무설치판)

- `$oExcel = ObjCreate("Excel.Application")` → CSV Open → 행 색칠 → SaveAs.
- 노란색: `Range(...).Interior.Color = 65535` (BGR = RGB 255,255,0).
- 저장: `Workbook.SaveAs(path, 51)` (51 = xlOpenXMLWorkbook = .xlsx).
- Excel이 CSV를 직접 여니 값·형식은 사람이 수동으로 연 것과 동일.

---

## 5. 산출물 ① 자동 추출 (AutoIt) 메모

- `export_batch.au3`: `$CIRCUITS[[회로번호, 화면행index], …]` 목록을 받아 연속 처리.
  - 흐름: 회로 더블클릭 → Export → 파일명 입력 → Copy → Ok → 변환 완료 대기.
  - **크래시 감지**: `WinExists("Application Error")` → 닫고 1회 재시도.
  - **파일명=내용 보정**: 저장 후 첫 줄의 `Batt(\d+)` 읽어 실제 ID로 rename.
  - 좌표 상수(현장 보정값): `BASE_Y=202, ROW_H=16.2, COL_X=55`,
    `EXPORT[810,278], DEST[180,565], COPY[640,487], OK[640,567], CANCEL[810,644]`.
  - 버튼 클릭은 `ControlClick [TEXT:...]` 우선, 실패 시 좌표 클릭(`clickBtn`).
- `export_circuit.au3`: 회로 1개. 인자 `<회로번호> <행index>`, `rowY = BASE_Y + ROW_H*idx`.
- `capture_coords.au3`: 마우스 위치만 읽어 `coords.txt` 저장(좌표 영점용, 안전).

---

## 6. 배포 / 무인 운영

- `run_pipeline.bat`: (1) `export_batch.au3` → (2) `make_display_report.py`(또는 무설치판).
- `scheduler_setup.md`: Windows 작업 스케줄러에 매일 등록.
- 권장: 장비가 불안정하므로 **정리(②)는 별도 PC/공유폴더**에서 — BTS PC는 export만.

---

## 7. 함정과 교훈 (다음 사람이 같은 실수 안 하도록)

1. **BTS-600에서 AutoIt "Window Info(Finder Tool)" 절대 금지** — General Protection
   Fault로 장비가 죽는다(2회 발생). 좌표는 전체화면 스크린샷/`capture_coords.au3`로.
2. **`.bat`는 순수 ASCII + CRLF.** 한글 주석이 한국어 윈도우(CP949)에서 명령으로 잘못
   실행됨(`'쐩'은(는)…` 에러). `if ( )` 괄호블록 대신 `goto` 라벨(LF 파싱오류 회피).
3. **AutoIt 변수 대소문자 무시** — `$OUT`(경로) vs `$out`(내용) 충돌해 데이터가 경로에
   섞임. 변수명 구분할 것.
4. **AutoIt 한글 파일명 저장 실패** 가능 → AutoIt 산출물은 영문명(`_report.csv`).
   (Excel COM SaveAs 한글 경로는 OK)
5. **Windows용 zip은 한글 파일명에 UTF-8 플래그(0x800) 필수** — 없으면 해제 시 한글명
   파일이 사라진다. Python `zipfile` + `ZipInfo.flag_bits |= 0x800` 사용.
6. **무설치 파이썬 불가**: python.org·github 정책 차단으로 이 환경에선 임베디드 파이썬을
   못 받음(pypi만 열림). → ② 무설치는 **AutoIt+Excel COM** 이 정답.
7. **완료 시점 예측 금지** — 계속 바뀜. 상태가 `STO`로 바뀌는 것으로 완료 감지.
8. **스크린샷 ≠ Export 파일** — 화면값과 실제 export CSV가 다를 수 있어 CSV 기준으로.

### 미해결 / 다음 과제
- export 클릭 좌표 "영점" 정밀 재보정 (회로 행 위치 오프셋).
- 완전 무인화: 화면에서 완료 회로 자동 감지 → `$CIRCUITS` 목록 자동 생성.
- 작업 스케줄러 매일 자동 실행 최종 셋업.
- SAE CCA 표시 지점(0/5/10/30초+종료) 규격 재확인(참조본 없이 추정).

---

## 8. 파일 지도 (`automation/`)

| 파일 | 역할 |
|---|---|
| `export_batch.au3` | ① 배치 자동 Export |
| `export_circuit.au3` | 회로 1개 Export |
| `capture_coords.au3` | 좌표(영점) 안전 캡처 |
| `csv_to_report.au3` | ① 관리대장 요약(파이썬 X) |
| `make_display_report.py` | ② 표시 엑셀 (Python/openpyxl) |
| `make_report.au3` + `make_report.bat` | ② 표시 엑셀 (AutoIt+Excel, 무설치) |
| `run_pipeline.bat` | 전체 파이프라인(스케줄러용) |
| `report_guide.md` | ② 상세 사용법·규칙·검증 |
| `README.md` | 초기 조사·흐름 |
| `deploy_windows.md`, `scheduler_setup.md` | 설치·스케줄러 |
| `담당자_따라하기_가이드/*.html` | 시험실 담당자용 그림 가이드 |

프로토타입/탐색 코드는 `prototype/` (photo OCR, 대시보드, 차트, 판정 등 — 참고용).

---

## 9. 재현 절차 (처음부터)

1. 이 문서 + `.claude/skills/bts600-automation/SKILL.md`로 맥락 복원.
2. 샘플 CSV로 `python make_display_report.py <파일>` → 표시 규칙 눈으로 확인.
3. 새 시험 종류가 등장하면:
   - 원본 CSV + 사용자의 **수기 표시본(xlsx)** 확보.
   - xlsx의 노란 행을 데이터 인덱스로 역분석(블록/스텝타임/전류 관점).
   - 4.1의 규칙 프레임에 **새 분기** 추가, 예시로 검증(EXACT 목표, ±1 중복행은 허용).
4. 배포는 **무설치판 우선**. 담당자에겐 `담당자_따라하기_가이드` HTML 전달, 연습용 CSV로
   성공 경험 후 실제 데이터로.
