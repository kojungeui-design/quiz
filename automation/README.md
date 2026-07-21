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

## 경로 1 — Btsexp.exe 명령줄 (먼저 이걸 확인)

명령 프롬프트에서:
```
cd C:\BTS-600
Btsexp.exe /?
Btsexp.exe -?
Btsexp.exe
```
→ 사용법(usage)이 뜨면 명령줄 지원. 인자로 배터리/회로/출력경로를 넘길 수 있으면
   `run_daily.bat`이 40개를 반복 호출해 CSV를 뽑는다. **화면 자동화 불필요.**
→ 아무 반응 없거나 GUI만 뜨면 경로 2로.

Digatron 대리점에 "Btsexp의 배치/명령줄 export 방법"을 문의하면 확실.

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
