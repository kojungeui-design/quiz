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
- **세계지도** — 나라별 판매 분포를 지도에 찍는다. 버블을 누르면 그 나라 제품 목록으로 간다.
- **판매지역** — 지역 × 기술 커버리지 매트릭스로 라인업 공백을 찾는다.
- **유통사·경쟁브랜드** — 유통사 한 곳이 무슨 브랜드를 같이 취급하는지 본다.
  바이어는 우리 것만 팔지 않으니, 같은 진열대에 오르는 브랜드가 그 나라 경쟁 상대다.
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

### 사내 바이어 DB 가져오기

사내 `배터리 설계·수익성 검토 시스템` HTML 안에는 바이어 DB 가 gzip+base64
(`buyerDataB64`)로 들어 있다. 바이어번호·바이어명·제품형명·C20·RC·CCA(SAE/EN)·
바이어 표기치가 한 행씩 붙어 있어서, 실제로 어느 나라에 무슨 제품을 파는지가
거기 다 있다.

```bash
python3 tools/buyer_html_to_csv.py 시스템.html 출력폴더
```

바이어명에서 국가를 뽑아(`BOSCH CONGO`, `YBS(FRANCE)`, `A-MAP(ARMENIA)`)
제품형명 × 국가로 묶어준다. 국가를 못 뽑은 바이어는 `buyer_unmapped.csv` 에
남으니 채워서 `--map` 으로 다시 넣으면 반영된다.

임포트한 행은 **IndexedDB** 에 저장된다. localStorage 는 5MB 근처에서 막혀
수만 행을 넣으면 새로고침에 날아가기 때문이다.

### 유통사를 경쟁 브랜드 발굴 경로로

바이어(유통사)는 우리 배터리만 취급하지 않는다. 한 유통사 사이트에 같이 올라와
있는 브랜드가 그 나라 경쟁 구도다. 호주 Century Yuasa 한 곳만 봐도
Century·GS Yuasa·Besco·Maxx Yuasa·Katana·Enersun·Intelepower·Optima 를 같이 굴리고,
영국 Tayna 는 Varta·Bosch·Yuasa·Exide·Numax·Lucas·Powerline·Odyssey 를 나란히 판다.

```bash
python3 tools/collect.py --brands        # 유통사 사이트를 훑어 취급 브랜드를 찾는다
```

`data/distributor_sources.csv` 에 유통사·사이트·제품목록 URL 을 넣어두면
브랜드 사전과 대조해 `catalogs/discovered_brands.csv` 를 만든다.
아직 우리 DB 에 없는 브랜드는 앱 [유통사·경쟁브랜드]에서 붉게 표시된다.

바이어를 한 곳씩 되짚어 44곳까지 채웠고, 그 과정에서 이런 것들이 나왔다.

- **AAP = Alliance Automotive Group UK & IE.** NAPA UK·Tayna(2023 인수)·
  Platinum Batteries(2018 인수)·FPS 가 전부 한 그룹이다. 영국 배터리 채널로
  들어가는 문이 사실상 이 하나다.
- **YBS/YBIT = GS Yuasa 유럽 판매법인**(YBF 리옹·YBIB 마드리드·YBEU 뒤셀도르프).
- **MEBCO(사우디)** — Clarios 49% + 자밀·알조마이 등 사우디 투자자 51% 합작.
  아랍권 최대 납축전지 공장(연 340만 개)이고 **중동 ACDelco 를 여기서 만든다.**
  그래서 `acdelco_mea` 의 제조사를 ACDelco 가 아니라 MEBCO 로 바로잡았다.
- **Recor(그리스)** — 코모티니 공장, 1964년, 그리스 유일의 스타터배터리 생산자.
- **Roussakis(그리스)** — ACDelco·Yuasa·GS·Trojan 을 한 진열대에 올린다.
  브랜드별 URL 이 규칙적이라 통째로 긁기 좋다.
- **Nova Power Tech(인도)** — Amaron 을 유통하면서 계열 브랜드 Mantra 를 같이 판다.

끝내 못 찾은 바이어는 `TRANS PARTS(AUTO)`, `M/S NICKEL GLASS AND BATTERIES`,
러시아 Rocket 채널이다. 사명이 너무 일반적이라 공개 검색으로는 특정이 안 됐고,
`data/distributor_sources.csv` 에도 넣지 않았다 — 추정으로 채우면 근거가 무너진다.

### 브랜드 × 마켓

같은 브랜드라도 나라마다 파는 시리즈와 규격체계가 다르다. Bosch 가 대표적이라
유럽은 S3~S6 에 DIN·ETN, 북미는 S4·S5·S6 AGM 에 BCI 그룹, 인도는 S4+·T4·M6 까지,
중국은 저상 L2 계열이다. 그래서 **브랜드 × 마켓**을 1급 단위로 두고 카탈로그
주소·수집상태를 그 단위로 관리한다. `data/catalog_sources.csv` 의 URL 은
대표 홈페이지가 아니라 **실제 카탈로그·제품목록 주소**이고, 존재를 확인한
것과 경로를 추정한 것을 구분해 뒀다.

### 이 시스템을 다른 AI 로 다시 만들려면

`.claude/skills/battery-catalog/` 에 기획부터 검증까지 전 과정을 스킬로 떼어놨다.

| 파일 | 내용 |
|---|---|
| `SKILL.md` | 무엇을 만드는가 · 순서 · 어기면 안 되는 원칙 |
| `reference/01_domain.md` | 규격 49종 · CCA EN/SAE · 파생지표 · 데이터 스키마 |
| `reference/02_app.md` | 11개 뷰 · 저장소 · 폰 · PDF 근거 |
| `reference/03_collect.md` | 수집 엔진 · 정규식 함정 · 바이어 DB · 경쟁 브랜드 발굴 |
| `reference/04_workbook.md` | 엑셀 12시트 · 쓰면 안 되는 함수 |
| `reference/05_pitfalls.md` | 실제로 밟은 지뢰 12개 |
| `GPT_PROMPT.md` | ChatGPT 에 그대로 붙여넣는 8단계 프롬프트 |

Claude Code 는 `.claude/skills/` 를 알아서 읽는다.  ChatGPT 는 못 읽으니
프로젝트에 6개 md 를 업로드하고 `GPT_PROMPT.md` 의 단계별 프롬프트를 쓴다.

### 도구 (PC 가 있을 때)

```bash
# 사내 일본 제품 엑셀 → 앱 임포트용 CSV
pip install openpyxl
python3 tools/gb_japan_to_catalog_csv.py 일본제품리스트.xlsx gb_japan.csv

# 카탈로그 수집 — PDF·제품목록·사이트맵·URL패턴을 훑고 스펙까지 뽑는다
pip install requests pypdf
python3 tools/collect.py --check                 # 몇 개나 열리는지 먼저 (파일 안 받음)
python3 tools/collect.py --dry                   # 받을 URL 목록만 화면에
python3 tools/collect.py                         # 전체 수집
python3 tools/collect.py --only bosch_na bosch_in
python3 tools/collect.py --types pdf --loose     # 규격코드 없는 줄까지 주워담기
```

```bash
# 같은 데이터를 엑셀 워크북으로
node tools/dump_seed.js battery_catalog.html seed.json
python3 tools/build_workbook.py seed.json 글로벌_SLI_배터리_카달로그.xlsx
```

워크북은 11개 시트다 — 읽어보기 / 설정 / 규격마스터 / **카달로그** /
**지역별판매** / **사이즈별요약** / 제조사 / **브랜드마켓** / 차량적합성 /
지역커버리지 / 크로스레퍼런스.

- **카달로그** — 왼쪽부터 제품 → 사이즈(규격·치수) → 용량·CCA 순으로 놓았고,
  판매지역은 지역마다 열이 따로 있다(O 표시)라 필터로 바로 뽑힌다.
- **지역별판매** — 모델 × 판매지역을 한 행씩 편 롱포맷(1,276행).
  "유럽에서 파는 LN3, 70Ah 이상" 을 필터 두 번으로 뽑고, 피벗 원본으로도 쓴다.
- **사이즈별요약** — 규격마다 치수·용량범위·CCA범위·지역별 취급 수를 한 줄로.

파생지표와 집계는 값이 아니라 **수식**이라 스펙을 고치면 갭·커버리지가 따라
움직인다. 생성물이라 저장소에는 커밋하지 않는다(`.gitignore` 의 `*.xlsx`).

`collect.py` 가 만드는 것

- `catalogs/catalog_registry.csv` — 근거(파일·판·SHA-256·페이지수·수집일).
  앱의 [데이터 관리 → 카달로그 원본(PDF) 근거 등록] 에 올린다.
- `catalogs/collected_models.csv` — 자동 추출한 스펙. 앱의 [CSV 가져오기] 에 올린다.
  **자동 파싱이라 그대로 믿으면 안 된다.** 확신도가 같이 들어가니 낮은 행부터 원본과 대조한다.
- `catalogs/collect_log.csv` — URL 별 성공·실패·추출 건수.
- `catalogs/url_check.csv` — `--check` 결과. 주소별 응답코드와 열림/막힘.

받은 원본과 결과는 `catalogs/` 아래에 떨어지고 `.gitignore` 로 막아뒀다.
