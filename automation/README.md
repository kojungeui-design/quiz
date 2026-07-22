# BTS-600 일일 자동 Export → 엑셀 기입 자동화

Windows 7 · BTS-600 V1.600.395 · 40개 회로

## 화면 분석으로 확인한 사실

| 항목 | 확인 내용 |
|---|---|
| 데이터 저장 위치 | `C:\BTS-600\Environ\BATTERY\BATT00NN\<시험구간>\` |
| 데이터 형식 | `.DAS` / `.DAT` / `.DAH` **바이너리** (Digatron 전용) — CSV 아님 |
| CSV 생성 수단 | ① Test sections 창의 `Export` 버튼  ② `C:\BTS-600\Btsexp.exe` |
| 회로 구성 | 8 유닛(193.100.1.1~1.8) × 5 = 40 회로, `BATT0001`~ 폴더 |

> **결론**: 원본이 바이너리라 단순 파일복사는 불가. 반드시 Export(바이너리→CSV)를 자동 실행해야 함.

## 전체 자동화 흐름

```
매일 08:00  Windows 작업 스케줄러
   │
   ├─(1) BTS-600 Export 자동 실행 → 40개 회로 CSV를  C:\bts_csv\  에 저장
   │       경로 1: Btsexp.exe 명령줄 배치   (가능하면 최선)
   │       경로 2: AutoIt 화면 자동화       (확실한 대안)
   │
   └─(2) daily_report.py 실행 → 엑셀(일일 시험현황) 자동 기입 + 이상감지  ✅ 이미 완성
```

(2)는 이미 완성돼 있음(`prototype/daily_report.py`). 남은 건 (1) Export 자동화.

## 매뉴얼 확인 결과 (풀 매뉴얼 6.3 Data Export)

- **Export는 GUI 전용.** 명령줄·배치·자동·예약 export 기능은 매뉴얼에 **없음**.
- **"현재 선택된 test section 하나만" export** — 매뉴얼 명시(=하나씩만 됨 확정).
- macro/DDE/OLE/스크립트 등 외부 자동화 인터페이스도 없음.
- Export 형식: **ASCII / EXCEL / LOTUS / DIA-PC / BTS Tabelle** — EXCEL 직접 export 가능.
- 저장경로 파일명은 **DOS 8.3 규칙**(이름 8자 + 확장자 3자, 예: `CIRC0024.CSV`).

### 영상 분석으로 확정한 전체 export 흐름 (2026-07-22)
1. 메인 그리드에서 **대상 배터리 행 더블클릭** → 그 배터리 Test sections 창 열림
2. **맨 아래(최근=방금 끝난) 시험 구간 자동 선택**
3. **Export** 버튼 → Data export 대화상자
4. Destination file 지우고 파일명 입력 → **Copy**(대상 확정) → **Ok**
5. "Data file conversion" 진행창 (변환에 시간 소요) → 닫힐 때까지 대기
6. 원본: `C:\BTS-600\Environ\Battery\Batt00NN\<시험명>\<시험명>.dat` → `E:\...csv`
→ `export_circuit.au3` 에 이 흐름 반영 완료. 남은 건 좌표값 채우기뿐.

확인된 export 대화상자(실제 화면 "Battery - Data export"):
```
Export 버튼  →  Convert to: 형식 선택 (Excel 또는 ASCII)
             →  Type of conversion: ● File  (또는 ○ DDE)
             →  Destination file: 저장 경로 입력 (예: E:\CIRC0011.csv)
             →  Conversion of: 포함 항목 체크(기본값 유지)
             →  Places behind decimal: -1
             →  Ok 로 확정
```

### 발견 1 — DDE 옵션 존재 (고급 자동화 가능성)
export 대화상자의 "Type of conversion"에 **DDE** 라디오가 있음.
DDE(동적 데이터 교환)는 외부 프로그램이 BTS-600에서 데이터를 직접 받아올 수 있는
Windows 통신 방식. GUI 클릭 없이 데이터를 끌어오는 더 깨끗한 경로가 될 수 있으나,
구형·까다로운 방식이라 우선은 File+AutoIt로 진행하고 DDE는 후보로 남겨둠.

### 발견 2 — Excel 형식 + E: 드라이브 저장
Convert to에서 **Excel** 선택 시 .csv로 저장돼 우리 파이프라인이 그대로 읽음.
저장은 E: 드라이브 등 임의 경로 가능(예: `E:\bts_csv\`).

## 경로 1 — Btsexp.exe 명령줄  ❌ 매뉴얼상 근거 없음

매뉴얼에 명령줄/배치 export가 없으므로 **기대하지 않는다.**
`C:\BTS-600\Btsexp.exe`는 GUI가 내부적으로 호출하는 export 엔진으로 보이며,
문서화된 명령줄 인터페이스가 없다. (혹시 몰라 `Btsexp.exe /?`를 한 번 쳐볼 수는
있으나, 안 되는 것으로 가정하고 경로 2로 진행한다.)

## 경로 2 — AutoIt 화면 자동화

`export_daily.au3` 참고. Test sections 창에서 Export 버튼을 자동 클릭해 CSV 저장을
회로 수만큼 반복. **단, Export 버튼을 누른 뒤 뜨는 대화상자(형식·파일명·경로 지정)
화면이 필요함** — 그 스크린샷을 받으면 스크립트를 완성한다.

## 설치·설정

1. `run_daily.bat` 을 `C:\BTS-600\automation\` 에 둔다
2. `daily_report.py` + 파이썬(또는 배포용 exe)을 같은 PC 또는 수집 서버에 둔다
3. Windows 작업 스케줄러에 매일 08:00 `run_daily.bat` 실행 등록 (`scheduler_setup.md`)
4. 출력 엑셀을 공유폴더/메일로 배포 (선택)

## 보안 (Win7)

Windows 7은 지원종료 OS. 사내망에서 공유·스크립트 실행 전 정보보안팀과
"이 PC에서 나가는 단방향 데이터 반출"로 협의 권장.
