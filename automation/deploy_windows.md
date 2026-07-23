# Windows 배포 — CSV 정리 자동화 연결

export까지는 AutoIt으로 됨. 이제 **CSV → 관리대장** 정리를 이 PC에서 돌리도록 붙인다.

## 필요한 것

1. **Python 설치** (CSV 정리용)
   - Windows 7이면 **Python 3.8.x** (3.9+는 Win7 미지원)
   - 설치 시 "Add Python to PATH" 체크
   - 설치 후 명령창에서: `pip install openpyxl`
   - ※ Python은 BTS-600과 별개로 돌아가 시험에 영향 없음 (CSV 파일만 읽음)

2. **스크립트 폴더 만들기**: `C:\bts_auto\`
   여기에 아래 파일들을 복사:
   - `export_batch.au3`  (export 자동화)
   - `daily_report.py`, `bts600_extract.py`, `bts600_analyzer.py`, `judge.py`  (CSV 정리)
   - `run_pipeline.bat`  (전체 연결)

## 흐름

```
run_pipeline.bat 실행
   ↓ (1) export_batch.au3  → E:\bts_csv 에 CSV 생성
   ↓ (2) daily_report.py   → 관리대장(daily_status.xlsx) 생성
끝
```

- CSV 정리는 **파일명이 아니라 파일 안의 Battery ID를 읽으므로** 이름이 틀려도 정확.

## 매일 자동 실행

작업 스케줄러에 `run_pipeline.bat`를 매일 정해진 시간 등록 (scheduler_setup.md 참고).

## 처리 대상(완료된 회로) 목록은?

`export_batch.au3` 맨 위 `$CIRCUITS` 에 [회로번호, 행index] 목록.
- **지금**: 사람이 완료된 회로를 목록에 넣음 (반자동)
- **완전 무인**: 화면 스크린샷 → AI(Claude API)가 완료 회로 감지 → 목록 자동 생성

## 안전(권장)

BTS-600 PC가 불안정하므로, 가능하면 **CSV 정리(2단계)는 별도 PC/서버**에서 돌리는 것이 안전:
- BTS PC: export만 → CSV를 공유폴더에 저장
- 다른 PC: 공유폴더의 CSV를 정리 → 관리대장
이러면 정리 작업이 시험 장비를 전혀 안 건드림.
