# 앱 사양 — 단일 파일 HTML

## 형태

**외부 자원을 하나도 쓰지 않는 단일 `.html` 파일.** CDN 스크립트·웹폰트·원격
이미지 전부 금지. 이유:

- `file://` 로 열어도 돌아야 한다 (폰에 저장해서 더블탭)
- 사내망·오프라인·CSP 강한 환경에서 그대로 열려야 한다
- GitHub Pages 에 올리면 경로 설정 없이 바로 뜬다

파일이 300KB 를 넘어가면 편집이 지옥이 된다. **`part1_head.html`(마크업·CSS) /
`part2_data.js`(시드) / `part3_app.js`(로직)** 로 쪼개 작업하고 마지막에 이어
붙여라. 시드 생성은 스크립트로 하고, 붙인 뒤 `node --check` 로 문법을 본다.

## 11개 뷰

| 키 | 이름 | 하는 일 |
|---|---|---|
| `dash` | 대시보드 | 기술·용도·지역·규격체계별 구성, 용도군 평균 성능, 수집 필요 목록, **데이터 신뢰도 경고** |
| `cat` | 카달로그 | 모델별 스펙 + 파생지표 + 상대점수. 행 클릭 → 상세 서랍(동일 규격 경쟁 모델·적용 차종) |
| `fit` | 차량 적합성 | 차종 요구 스펙 → 적합 모델 자동 매칭, 자사 우선 정렬 |
| `cmp` | 성능 비교 | 최대 8개 나란히, 가중치 슬라이더 |
| `xref` | 규격 크로스레퍼런스 | 규격별 자사 최고 vs 타사 최고 격차, AGM 라인업 공백 |
| `map` | 세계지도 | 나라별 분포. 버블 클릭 → 그 나라 제품 목록 |
| `rgn` | 판매지역 | 지역 × 기술 커버리지 매트릭스 |
| `bm` | 브랜드·마켓 | 브랜드 × 국가별 시리즈·규격체계·카달로그 실주소·수집상태 |
| `dist` | 유통사·경쟁브랜드 | 유통사가 같이 취급하는 브랜드. **우리 DB 에 없는 브랜드는 붉게** |
| `src` | 제조사·수집관리 | 수집상태·판(edition)·PDF 파일명·SHA-256·수집일 |
| `data` | 데이터 관리 | CSV 가져오기/내보내기, JSON 백업, 폰 PDF 등록, 품질 점검 |

## 세계지도 — 산점도가 되지 않게

`<svg>` 에 등장방형(equirectangular) 투영으로 직접 그린다.

```js
const proj = (lat, lon) => [(lon + 180) / 360 * 1000, (90 - lat) / 180 * 500];
```

**대륙 윤곽 폴리곤을 반드시 넣어라.** 버블만 찍으면 지도가 아니라 산점도로
보인다. 대륙별 거친 폴리곤을 `[[lat,lon], ...]` 웨이포인트 배열로 손으로 넣고
`proj` 를 통과시켜 `<path>` 로 그린다. 정밀할 필요 없다 — 대륙 모양만 알아보면
된다.

추가로:
- 라벨 충돌 회피 (이미 찍은 라벨 박스와 겹치면 생략)
- 버블 반지름은 판매 모델 수의 **제곱근**에 비례 (선형이면 큰 시장이 화면을 덮는다)
- 국가 단위 / 지역 단위 토글 — 데이터가 성길 때는 지역 버블이 낫다

## 저장소 — localStorage 만 쓰면 터진다

| 무엇 | 어디 |
|---|---|
| 사용자가 고친 값, 설정, 근거 메모 | `localStorage` |
| **CSV 로 임포트한 대량 행** | **IndexedDB** |

localStorage 는 5MB 근처에서 막힌다. 16,000행짜리 사내 데이터를 넣으면
`QuotaExceededError` 가 뜨고 새로고침에 전부 날아간다. 임포트 행은 IndexedDB 로
보내고, localStorage 에는 이렇게 저장한다:

```js
save() {
  localStorage.setItem(KEY, JSON.stringify(
    Object.assign({}, store, {imported: idbFailed ? store.imported : []})));
}
```

IndexedDB 를 못 쓰는 환경(사파리 프라이빗 등)을 대비해 `idbFailed` 플래그로
localStorage 폴백을 남긴다.

**시드와 사용자 데이터를 섞지 마라.** 시드는 코드에 박고, 사용자가 바꾼 것만
따로 쌓는다. 그래야 나중에 시드를 갱신해도 사용자 데이터가 안 날아간다.
`SEED_VERSION` 을 두고 올린다.

## 폰

```css
@media (max-width: 820px) {
  /* 사이드 메뉴 → 하단 탭 */
  .side { position: fixed; left: 0; right: 0; bottom: 0; top: auto;
          flex-direction: row; overflow-x: auto; z-index: 50; }
  /* 표 → 카드 */
  table:not(#tbCmp) thead { display: none; }
  table:not(#tbCmp) tbody tr { display: block; background: #fff;
                               border-radius: 11px; padding: 9px 12px; }
  table:not(#tbCmp) tbody td::before { content: attr(data-l); color: var(--muted); }
  table:not(#tbCmp) tbody td.mhide { display: none; }   /* 폰에서 숨길 열 */
  /* 그리드는 전부 1열로 — 2열로 남기면 가로 스크롤이 생긴다 */
  .g4, .g3 { grid-template-columns: 1fr 1fr; }
  .g2 { grid-template-columns: 1fr; }
  input[type=file] { max-width: 100%; }
}
```

비교 표(`#tbCmp`)만 카드화에서 뺀다 — 나란히 놓는 게 목적이라 가로 스크롤이 맞다.

**모든 뷰에서 가로 스크롤이 없는지 직접 확인해라.** 뷰포트 390px 로 잡고
`document.documentElement.scrollWidth > clientWidth` 를 뷰마다 찍어본다.

내보내기는 Web Share API 로:

```js
if (navigator.share && navigator.canShare?.({files: [file]}))
  await navigator.share({files: [file], title: name});
else /* a[download] 폴백 */
```

## PDF 근거 — 폰에서도 기기 안에서만

카달로그 PDF 를 고르면 브라우저가 직접 계산해 근거로 남긴다. **서버로 안 보낸다.**

- **SHA-256** — `crypto.subtle.digest`. 단 `file://` 에서는 `crypto.subtle` 이
  없다(보안 컨텍스트 아님). **순수 JS SHA-256 폴백을 반드시 넣어라.**
  구현했으면 NIST 테스트 벡터 3개로 검증한다:
  - `""` → `e3b0c442...b855`
  - `"abc"` → `ba7816bf...ad15`
  - `"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"` → `248d6a61...f1`
- **페이지 수** — `/Type\s*/Page[^s]` 개수 또는 `/Count` 값
- **제목** — `/Title (...)` 
- **판(edition)·발행연도** — `20\d\d` 와 `edition|rev|ver` 주변 텍스트

## 필터 이벤트 — `change` 를 쓰면 클릭이 죽는다

검색 입력에 `onchange` 를 걸면: 사용자가 타이핑 → 결과 행을 클릭 → 클릭 전에
blur 가 발생 → `change` 발화 → 재렌더로 그 행이 사라짐 → **클릭이 허공을 친다.**

```js
function bindFilter(id, fn) {
  const el = document.getElementById(id);
  const ev = (el.tagName === 'INPUT' && el.type === 'text') ? 'oninput' : 'onchange';
  el[ev] = fn;
}
```

그리고 렌더를 `renderXFilters()` / `renderXTable()` 로 쪼개라. 입력할 때마다
필터 UI 까지 다시 그리면 포커스가 튄다.

## 대량 행

카달로그 뷰가 16,000행을 한 번에 DOM 에 그리면 폰에서 멈춘다.
`CAT_PAGE = 300` 으로 끊고 "더 보기" 버튼을 둔다.

## 검증

헤드리스 크로미움(Playwright)으로:

```js
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
```

- 11개 뷰 전부 클릭 → 행 수·텍스트 길이 확인
- 행 클릭 → 서랍 열림 확인
- 체크박스 2개 → 비교 뷰 열 수 확인
- 필터 입력 → 행 수 변화 확인
- CSV 임포트 → 새로고침 → 잔존 확인
- 뷰포트 390px 로 전 뷰 가로 오버플로 확인
- **JS 에러 0**
