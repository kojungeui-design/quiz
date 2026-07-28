# 수집 — 카달로그 · 바이어 DB · 경쟁 브랜드

## 0. 먼저 알아야 할 것

**샌드박스·클라우드 작업 환경은 제조사 도메인을 거의 다 막는다.**
Bosch·Exide·Amaron·GS Yuasa 전부 403 CONNECT 가 돌아온다. 그래서 목표를 바꿔라:

> 내가 만드는 것은 "완성된 DB" 가 아니라 **"수집 엔진 + 검증된 URL 레지스트리"** 다.
> 사용자가 사내망에서 한 줄 돌리면 그때 진짜 DB 가 된다.

이걸 **처음부터 사용자에게 말해라.** 다 만든 뒤에 "사실 못 받았다" 고 하면 안 된다.

그리고 **가장 먼저 만들 모드는 `--check` 다.** 사용자가 자기 네트워크에서
"몇 개나 열리나" 를 1~2분에 알아야 그 다음을 정할 수 있다.  받지 않고 HEAD 만
날리되, HEAD 를 막는 서버가 많으니 400/401/403/405/501 이면 GET 으로 한 번 더
본다.  끝에 **판정 문장을 직접 찍어라** — 사용자가 CSV 를 열어 세게 하지 마라.

    주소 77개 중 41개가 열린다.
    아주 좋다 — 바로 전체 수집으로 가도 된다.

`--dry`(목록만 출력)와 `--check`(실제로 두드려 봄)를 **헷갈리게 이름 짓지 마라.**
`--dry` 는 아무 파일도 안 만든다.  이걸 "살아있는지 확인" 이라고 안내했다가
사용자가 있지도 않은 결과 파일을 찾은 적이 있다.

## 1. URL 레지스트리 — `data/catalog_sources.csv`

```csv
브랜드마켓,브랜드,제조사,마켓,유형,URL,패턴변수,확인,비고
bosch_na,Bosch,Clarios,북미,pdf,https://www.boschautoparts.com/documents/.../Batteries%20Catalog.pdf,,검색확인,2025 승용·경트럭 카탈로그
bosch_lat,Bosch,Clarios,중남미,productlist,https://br.boschaftermarket.com/br/pt/pecas/baterias/,,패턴추정,국가별 포털 규칙
```

- `유형` — `pdf` / `productlist` / `sitemap` / `pattern`
- `확인` — `검색확인`(존재 확인함) / `패턴추정`(규칙에서 유추)
- **대표 홈페이지는 넣지 마라.** 카달로그 PDF 직링크나 제품목록 페이지만.

국가별 포털은 패턴으로 잡는다:
`https://{cc}.boschaftermarket.com/{cc}/en/parts/batteries/`

## 2. 수집 엔진 — `tools/collect.py`

```bash
python3 collect.py --dry                    # 받을 URL 목록만 화면에 (요청 안 함)
python3 collect.py --check                  # 받지 않고 몇 개나 열리는지 (제일 먼저)
python3 collect.py                          # 전체
python3 collect.py --only bosch_na bosch_in
python3 collect.py --types pdf --loose      # 규격코드 없는 줄까지
python3 collect.py --brands                 # 유통사 사이트에서 취급 브랜드 발굴
```

의존성은 `requests` + `pypdf` 만. 무거운 크롤러 프레임워크를 끌어오지 마라.

### 스펙 추출 정규식 — 함정이 있다

```python
SIZE_RE = {
  'JIS': re.compile(r'\b([BDEFGH]\d{2})\b'),
  'ISS': re.compile(r'\b([KMNQST]-\d{2,3})\b'),
  'LN':  re.compile(r'\b(L?BN?\d)\b', re.I),
  'BCI': re.compile(r'\bgroup\s*(?:size\s*)?(\d{2,3}[RF]?|H[3-9])\b', re.I),
  'ETN': re.compile(r'\b(\d{3}\s?\d{3}\s?\d{3})\b'),
}

CCA_RE = re.compile(
    r'(?:CCA|cold\s*crank\w*)\s*[:\-]?\s*(\d{3,4})'
    r'|(\d{3,4})\s*A(?![a-z])\s*\(?(EN|SAE|DIN)?\)?', re.I)
```

**`A(?![a-z])` 의 부정 선읽기가 핵심이다.** 없으면 `100Ah` 를 CCA 100 으로 읽는다.

**BCI 는 `group` 키워드를 요구해라.** 안 그러면 문서의 아무 두세 자리 숫자를
전부 BCI 그룹으로 집어삼킨다.

추출 행마다 **확신도**를 같이 낸다(규격·용량·CCA 가 한 줄에 다 잡혔나, 규격
코드가 명시적인가). 사용자가 낮은 것부터 원본과 대조한다.

### 산출물

| 파일 | 내용 |
|---|---|
| `catalogs/catalog_registry.csv` | 근거 — 파일·판·SHA-256·페이지수·수집일 |
| `catalogs/collected_models.csv` | 자동 추출 스펙 + 확신도 |
| `catalogs/collect_log.csv` | URL 별 성공·실패·추출 건수 |
| `catalogs/discovered_brands.csv` | 유통사별 발견 브랜드 |
| `catalogs/url_check.csv` | `--check` 결과 — 주소별 응답코드·열림/막힘 |

`catalogs/` 는 `.gitignore` 한다 — 제조사 저작물이다.

## 3. 유통사를 경쟁 브랜드 발굴 경로로 — 가장 값싼 확장

**바이어는 우리 것만 팔지 않는다.** 한 유통사 사이트에 같이 올라와 있는 브랜드가
그 나라 경쟁 구도다. 이건 제조사 사이트를 100개 뒤지는 것보다 훨씬 빠르다.

호주 Century Yuasa 한 곳에 Century·GS Yuasa·Besco·Maxx Yuasa·Katana·Enersun·
Intelepower·Optima 가 같이 걸려 있고, 영국 Tayna 는 Varta·Bosch·Yuasa·Exide·
Numax·Lucas·Powerline·Odyssey 를 나란히 판다.

`data/distributor_sources.csv`:

```csv
유통사키,유통사,국가,지역,사이트,제품목록URL,브랜드페이지패턴,취급 브랜드,확인,비고
tayna,Tayna Batteries,영국,EU,https://www.tayna.co.uk,https://www.tayna.co.uk/car-batteries/,https://www.tayna.co.uk/car-batteries/{brand}/,Varta|Bosch|Yuasa|Exide|Numax,검색확인,브랜드별 URL 규칙적
```

`{brand}` 패턴이 잡히면 브랜드별 목록을 통째로 긁을 수 있다.

`--brands` 모드는 유통사 사이트 텍스트를 브랜드 사전(~90개)과 대조한다.
앱 [유통사·경쟁브랜드] 뷰는 **우리 DB 에 없는 브랜드를 붉게 표시**한다 — 그게 공백이다.

## 4. 사내 바이어 DB 를 캐낸다

사내 시스템 HTML 안에 데이터가 gzip+base64 로 들어있는 경우가 흔하다.

```html
<script id="buyerDataB64" type="application/octet-stream">H4sIAAAA...</script>
```

```python
import gzip, base64, json, re
m = re.search(r'id="buyerDataB64"[^>]*>([A-Za-z0-9+/=\s]+)<', html)
rows = json.loads(gzip.decompress(base64.b64decode(m.group(1))).decode('utf-8'))
```

배열의 배열로 오면 필드명을 순서대로 매핑한다(`BUYER_FIELDS`).
바이어번호·바이어명·제품형명·C20·RC·CCA(SAE/EN)·바이어 표기치가 한 행씩 붙어 있어
**실제로 어느 나라에 무슨 제품을 파는지가 거기 다 있다.**

### 바이어명에서 국가 뽑기

`BOSCH CONGO` · `YBS(FRANCE)` · `A-MAP(ARMENIA)` 처럼 국가가 이름에 붙어 있다.
국가 사전으로 매칭하되 **긴 이름부터 검사해라.** 그래야 `GUINEA` 가
`EQ. GUINEA` 를 먹지 않는다.

```python
COUNTRY = sorted(COUNTRY, key=lambda x: -len(x[0]))
```

국가를 못 뽑은 바이어는 `buyer_unmapped.csv` 로 빼고, 사람이 채워서 `--map` 으로
다시 넣게 한다. 억지로 매칭하지 마라.

### 사내 엑셀 → 임포트 CSV

- 값 범위 가드를 반드시 넣어라. 셀에 오타·메모가 섞여 들어온다.
  ```python
  SANE = {"c20": (10, 300), "rc": (10, 700), "sae": (100, 2000), "en": (100, 2000)}
  ```
  범위를 벗어나면 버리고 라벨값으로 폴백한다. 안 그러면 "D23 용량 57~1452Ah"
  같은 통계가 나온다.
- 지역 분류는 **일반 국가 키워드**로 한다. 고객사명을 규칙에 박으면 그 스크립트를
  공개 저장소에 못 올린다.

## 5. 공개 저장소 규칙

| 올린다 | 안 올린다 |
|---|---|
| 변환 스크립트 | 변환 결과 CSV |
| 공개 확인된 유통사 실명·URL | 사내 바이어 목록 |
| 규격 표준·제조사 공개 스펙 | 고객품번·납품처·오더량 |
| — | 카달로그 PDF 원본 (제조사 저작물) |

작업 시작 전에 **저장소가 공개인지 먼저 확인**해라.
