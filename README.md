# quiz

브라우저에서 바로 여는 사내 도구 모음. 각 HTML 파일은 그 자체로 완결이라
더블클릭하거나 GitHub Pages 로 열면 바로 돌아간다.

| 파일 | 하는 일 |
|---|---|
| `battery_catalog.html` | 전세계 SLI(AGM·EFB·일반액식) 납축전지 카달로그 · 성능 · 차량 적합성 · 판매지역 관리 |
| `eu_battery_compliance.html` | EU 배터리 규정 SLI 준수 관리 |
| `eu_battery_buyers.html` | EU 바이어/제품 준수 현황 |
| `index.html` | 배터리 퀴즈 |
| `youtube-slides-pdf/` | 유튜브 강의 → 슬라이드 PDF 변환기 |

## battery_catalog.html

제조사·유통사 카달로그에서 모은 SLI 배터리 성능을 한 곳에 모아 비교하고,
차종별 적합성과 지역별 커버리지를 관리한다.

- **카달로그** — 규격·용량·CCA·무게에서 CCA/Ah, Wh/kg, Wh/L 을 자동 계산하고
  같은 용도군 안에서 상대 점수를 매긴다.
- **차량 적합성** — 차종이 요구하는 규격·용량·CCA·기술(ISG 차량은 EFB/AGM)에
  맞는 모델을 자동 매칭한다.
- **규격 크로스레퍼런스** — 규격별로 자사 최고 스펙과 타사 최고 스펙의 격차,
  AGM 라인업 공백을 본다.
- **판매지역** — 지역 × 기술 커버리지 매트릭스로 라인업 공백을 찾는다.
- **제조사·수집관리** — 카달로그를 어디서 언제 받았는지, 판(edition)·PDF 파일명·
  SHA-256 까지 근거로 남긴다.

### 폰만으로 하는 수집

PC 없이 폰에서 전부 된다.

1. [제조사·수집관리]에서 링크를 눌러 카달로그 PDF 를 폰에 저장한다.
2. [데이터 관리 → 폰에서 바로 등록]에서 그 파일을 고르면
   **SHA-256·페이지수·제목·판(edition)·발행연도를 브라우저가 직접 계산**해
   제조사별 근거로 남긴다. 서버로 올라가지 않고 기기 안에서만 처리된다.
3. PDF 를 보면서 [카달로그]의 해당 모델을 고치고 근거를 `공개스펙` 으로 바꾼다.

좁은 화면에서는 표가 카드로 바뀌고 메뉴가 하단 탭으로 내려간다.
CSV·백업 내보내기는 공유 시트로 떠서 메신저·메일로 바로 보낼 수 있고,
브라우저의 **홈 화면에 추가**를 쓰면 앱처럼 열린다.

### 데이터 취급 원칙

이 저장소는 **공개**다. 그래서

- 시드 데이터에는 공개 규격 표준과 제조사 공개 스펙만 들어 있다.
- 사내 제품 리스트(고객품번·납품처·오더량)는 **커밋하지 않는다.**
  CSV 로 올리면 그 기기 브라우저의 localStorage 에만 저장된다.
  폰과 PC 를 같이 쓰려면 [전체 JSON 백업]으로 내보내 옮긴다.
- 제조사 카달로그 PDF 원본은 저작물이라 `catalogs/` 를 `.gitignore` 처리했다.

### 도구 (PC 가 있을 때)

```bash
# 사내 일본 제품 엑셀 → 앱 임포트용 CSV
pip install openpyxl
python3 tools/gb_japan_to_catalog_csv.py 일본제품리스트.xlsx gb_japan.csv

# 제조사 카달로그 PDF 수집 + 근거(SHA-256·페이지수·수집일) 기록
pip install requests
python3 tools/fetch_catalogs.py            # data/catalog_sources.csv 를 돈다
python3 tools/fetch_catalogs.py --only exide banner
```

`fetch_catalogs.py` 가 만든 `catalogs/catalog_registry.csv` 를
앱의 [데이터 관리 → 카달로그 원본(PDF) 근거 등록] 에 올리면
제조사별 카달로그 판·파일·해시가 채워진다.
