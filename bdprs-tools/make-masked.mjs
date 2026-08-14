/**
 * bdprs-tools/make-masked.mjs — BDPRS(배터리 설계·수익성 검토 시스템) 시연용 마스킹본 생성.
 *
 *   node make-masked.mjs <원본.html> <출력.html>
 *
 * 원본에는 고객사 실명, 고객별 매출액·영업이익, 극판 단가가 평문(압축)으로 들어 있고
 * 로그인은 클라이언트 장식이라 아무것도 보호하지 못한다. 사외 시연에는 이 스크립트가
 * 만든 마스킹본만 써야 한다.
 *
 * 마스킹 규칙 (설계 스튜디오 시연본과 같은 원칙 — 엔지니어링은 남기고 사업정보만 가린다)
 *   · 고객·납품처: 실명/코드 → "C#### 고객사-####" 일련번호. 같은 고객은 어디서나 같은 번호.
 *   · 제품형명 안의 고객 브랜드 토큰("...(NAKANO)")도 함께 지운다.
 *   · 매출액·판관비: 전체 중앙값=100 인 상대지수. 분포 모양은 남고 절대액은 사라진다.
 *   · 영업이익률: 5%p 구간값. 영업이익은 (상대 매출액 × 구간 이익률)로 재계산 —
 *     원래 이익률이 역산되지 않게 하기 위해서다.
 *   · 판매수량: 100 / 1,000 / 10,000 구간값.
 *   · 극판 단가: 중앙값 대비 상대비율. 상대 비교는 되고 절대가는 사라진다.
 *   · 내장 세컨드 앱(bis-portfolio, 7.5MB — 자체 데이터 사본 보유): 안내 페이지로 교체.
 *   · 로그인 계정: demo / demo (원본 관리자 암호가 파일에 남지 않게).
 *   · 물리·엔지니어링 데이터(성능, 치수, 중량, COS, 극판조합)는 그대로 둔다.
 *
 * 설계 원칙: 문자열 치환을 코드 전체에 함부로 걸지 않는다. 브랜드 토큰 소거는 **데이터 안에서만**
 * 수행한다. (초기 구현은 HTML 전체에 토큰을 치환해 `SALES_2026_B64` 같은 코드 식별자까지
 * 바꿔버렸다. 데이터와 코드를 구분하지 않는 치환은 조용히 앱을 망가뜨린다.)
 *
 * 마지막에 원본 실명·금액이 출력물 어디에도(압축 블롭 내부 포함) 남지 않았는지 전수 검증하고,
 * 남아 있으면 파일을 만들지 않고 실패한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import vm from 'node:vm';

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('사용법: node make-masked.mjs <원본.html> <출력.html>');
  process.exit(1);
}

let html = readFileSync(inFile, 'utf8');
const originalSize = html.length;

const decodeGz = (b64) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
const encodeGz = (text) => gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64');

/** 정규식으로 잡은 영역 안에서 가장 긴 b64 블롭을 찾아 돌려준다. */
function findBlob(anchorRegex) {
  const anchor = html.match(anchorRegex);
  if (!anchor) throw new Error(`앵커를 찾지 못했습니다: ${anchorRegex}`);
  const blobs = anchor[0].match(/[A-Za-z0-9+/=]{20000,}/g);
  if (!blobs) throw new Error(`b64 블롭이 없습니다: ${anchorRegex}`);
  return { region: anchor[0], blob: blobs.reduce((a, b) => (a.length >= b.length ? a : b)) };
}

/** 블롭을 변환해 되박는다. */
function transformBlob(anchorRegex, transform) {
  const { region, blob } = findBlob(anchorRegex);
  html = html.replace(region, region.replace(blob, transform(blob)));
}

const ANCHORS = {
  sales26: /SALES_2026_B64="[^"]+"/,
  sales25: /<script id="salesDataB64"[^>]*>[^<]+<\/script>/,
  buyer: /<script id="buyerDataB64"[^>]*>[^<]+<\/script>/,
  master: /__P_B64="[^"]+"/,
  prodyr: /var PRODYR=window\.__gunzipJSON\("[^"]+"/,
  portfolio: /<script id="bis-portfolio-gz"[^>]*>[^<]+<\/script>/,
};

/* ============================================================
   1단계 — 선행 패스: 고객 사전과 브랜드 토큰을 먼저 확정한다.
   ============================================================ */

const sales26 = JSON.parse(decodeGz(findBlob(ANCHORS.sales26).blob));
const sales25 = JSON.parse(decodeGz(findBlob(ANCHORS.sales25).blob));
const buyerRows = JSON.parse(decodeGz(findBlob(ANCHORS.buyer).blob));

const aliasByCode = new Map();
const aliasByName = new Map();
const realNames = new Set();
let aliasSeq = 0;

const normName = (v) => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();

function aliasOf(code, name) {
  const codeKey = String(code || '').trim();
  const nameKey = normName(name);
  if (nameKey) realNames.add(nameKey);
  let seq;
  if (codeKey && aliasByCode.has(codeKey)) seq = aliasByCode.get(codeKey);
  else if (!codeKey && nameKey && aliasByName.has(nameKey)) seq = aliasByName.get(nameKey);
  else {
    seq = ++aliasSeq;
    if (codeKey) aliasByCode.set(codeKey, seq);
    else if (nameKey) aliasByName.set(nameKey, seq);
  }
  const id = String(seq).padStart(4, '0');
  return { code: `C${id}`, name: `고객사-${id}` };
}

/** "1400884    BATERIAS GLOBAL AUTO" 형태의 결합 문자열 */
function maskCombined(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  const m = text.match(/^(\d{5,})\s+(.*)$/);
  const { code, name } = m ? aliasOf(m[1], m[2]) : aliasOf('', text);
  return m ? `${code}    ${name}` : name;
}

// 사전을 미리 채운다 (번호가 파일 전체에서 일관되도록).
for (const r of sales26) {
  maskCombined(r['고객']);
  maskCombined(r['납품처']);
}
for (const r of sales25) {
  maskCombined(r[6]);
  maskCombined(r[7]);
}
for (const r of buyerRows) {
  aliasOf(r[2], r[3]);
  maskCombined(r[15]);
}

/**
 * 선행 패스에서 모은 "진짜 고객명" 스냅샷. 이후 단계에서 aliasOf() 가 대시보드 리터럴 값
 * (제품군이 섞여 들어오기도 한다)을 추가로 등록하므로, 평문 치환과 유출 검증은 반드시
 * 이 스냅샷만 기준으로 삼는다. 그러지 않으면 제품군명("BCI 31")까지 지우려 들고
 * 유출 오탐이 난다.
 */
const customerNames = new Set(realNames);

/** 제품형명 등에 박힌 고객 브랜드 토큰. 일반 명사는 제외한다. */
const GENERIC_WORDS = new Set([
  'BATTERY', 'BATTERIES', 'BATTER', 'GLOBAL', 'AUTO', 'AUTOMOTIVE', 'MOTOR', 'MOTORS', 'PARTS',
  'POWER', 'ENERGY', 'TRADING', 'SERVICE', 'SERVICES', 'FACTORY', 'GROUP', 'INTERNATIONAL',
  'COMPANY', 'CORP', 'GMBH', 'LTD', 'INC', 'WORKS', 'EUROPE', 'ASIA', 'AMERICA', 'USA', 'KOREA',
  'JAPAN', 'CHINA', 'MIDWEST', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'CENTRAL', 'UNION', 'CENTER',
  'CENTRE', 'SUPPLY', 'DISTRIBUTION', 'EQUIPMENT', 'INDUSTRIES', 'INDUSTRIAL', 'HOLDING',
  'HOLDINGS', 'IMPORT', 'EXPORT', 'GENERAL', 'NATIONAL', 'PACIFIC', 'ATLANTIC',
]);
const brandTokens = [...new Set(
  [...realNames].flatMap((n) => n.split(/[^A-Z]+/).filter((w) => w.length >= 5 && !GENERIC_WORDS.has(w))),
)].sort((a, b) => b.length - a.length); // 긴 토큰부터 지워야 부분 잔존이 없다

// 토큰 수백 개를 문자열마다 하나씩 돌리면 46,000행 × 수백 회가 되어 못 쓸 만큼 느리다.
// 하나의 교대(alternation) 정규식으로 합쳐 한 번만 훑는다.
const brandRegex = brandTokens.length
  ? new RegExp(`(?<![A-Za-z0-9])(?:${brandTokens.join('|')})(?![A-Za-z0-9])`, 'gi')
  : null;

/** 데이터 문자열(제품형명·사양문자열)에서 고객 브랜드만 지운다. 코드에는 절대 쓰지 않는다. */
function scrubBrands(value) {
  if (typeof value !== 'string' || !value || !brandRegex) return value;
  return value.replace(brandRegex, 'DEMO');
}

console.log(`고객 사전 확정 — ${aliasSeq}개사 · 브랜드 토큰 ${brandTokens.length}개`);

/* ---- 수치 마스킹 규칙 ---- */

const bucketQty = (qty) => (qty >= 10000 ? 10000 : qty >= 1000 ? 1000 : qty > 0 ? 100 : 0);
const bandRateFraction = (rate) => Math.round(rate / 0.05) * 0.05;
const bandRatePercent = (pct) => Math.round(pct / 5) * 5;

const positiveAmounts = [...sales26.map((r) => Number(r['매출액']) || 0), ...sales25.map((r) => Number(r[9]) || 0)]
  .filter((v) => v > 0)
  .sort((a, b) => a - b);
const amountFactor = 100 / (positiveAmounts[Math.floor(positiveAmounts.length / 2)] || 1);
const scaleAmount = (v) => Math.round(v * amountFactor * 100) / 100;
console.log(`매출액 상대지수 계수 산정 (중앙값=100) — 26년 ${sales26.length}행, 25년 ${sales25.length}행`);

/* ============================================================
   2단계 — 데이터 블롭 마스킹
   ============================================================ */

transformBlob(ANCHORS.sales26, () => {
  const masked = sales26.map((r) => {
    const amount = scaleAmount(Number(r['매출액']) || 0);
    const band = bandRateFraction(Number(r['영업이익률']) || 0);
    return {
      ...r,
      제품형명: scrubBrands(r['제품형명']),
      고객: maskCombined(r['고객']),
      납품처: maskCombined(r['납품처']),
      매출수량: bucketQty(Number(r['매출수량']) || 0),
      매출액: amount,
      영업이익: Math.round(amount * band * 100) / 100,
      영업이익률: band,
    };
  });
  return encodeGz(JSON.stringify(masked));
});
console.log('26년 판매실적 마스킹 완료');

// [부문, 제품코드, 제품형명, 극판Type, 조립매수, 제품군, 고객, 납품처, 매출수량, 매출액, 영업이익, 영업이익률%]
transformBlob(ANCHORS.sales25, () => {
  const masked = sales25.map((r) => {
    const row = [...r];
    row[2] = scrubBrands(row[2]);
    row[6] = maskCombined(row[6]);
    row[7] = maskCombined(row[7]);
    row[8] = bucketQty(Number(row[8]) || 0);
    row[9] = scaleAmount(Number(row[9]) || 0);
    row[11] = bandRatePercent(Number(row[11]) || 0);
    row[10] = Math.round(row[9] * (row[11] / 100) * 100) / 100;
    return row;
  });
  return encodeGz(JSON.stringify(masked));
});
console.log('25년 판매실적 마스킹 완료');

// 바이어 DB: idx2 고객코드, idx3 고객명, idx15 결합문자열. 나머지 문자열은 제품·사양.
transformBlob(ANCHORS.buyer, () => {
  const masked = buyerRows.map((r) => {
    const row = [...r];
    const { code, name } = aliasOf(row[2], row[3]);
    row[2] = code;
    row[3] = name;
    row[15] = maskCombined(row[15]);
    for (const i of [4, 5, 6, 15]) if (i !== 15) row[i] = scrubBrands(row[i]);
    row[15] = row[15]; // 이미 익명화됨
    return row.map((v, i) => (i === 2 || i === 3 || i === 15 ? v : scrubBrands(v)));
  });
  return encodeGz(JSON.stringify(masked));
});
console.log(`바이어 DB 마스킹 완료 — ${buyerRows.length}행`);

transformBlob(ANCHORS.master, (blob) => {
  const d = JSON.parse(decodeGz(blob));
  const salesIdx = d.keys.indexOf('sales');
  const nameIdx = d.keys.indexOf('name');
  if (salesIdx < 0) throw new Error('__P_B64 에 sales 열이 없습니다');
  for (const row of d.rows) {
    row[salesIdx] = bucketQty(Number(row[salesIdx]) || 0);
    if (nameIdx >= 0) row[nameIdx] = scrubBrands(row[nameIdx]);
  }
  console.log(`제품마스터 마스킹 완료 — ${d.rows.length}행`);
  return encodeGz(JSON.stringify(d));
});

transformBlob(ANCHORS.prodyr, (blob) => {
  const d = JSON.parse(decodeGz(blob));
  for (const code of Object.keys(d)) {
    for (const year of Object.keys(d[code])) d[code][year] = bucketQty(Number(d[code][year]) || 0);
  }
  console.log(`연도별 판매수량 구간화 완료 — ${Object.keys(d).length}제품`);
  return encodeGz(JSON.stringify(d));
});

// 잔여 데이터 블롭 일괄 소거.
// optmap·BOM 등 이름을 일일이 아는 것보다, 남은 gzip+JSON 블롭을 전부 훑어 문자열 값에서
// 고객 실명과 브랜드 토큰을 지우는 편이 빠뜨림이 없다. JSON 이 아닌 블롭(폰트·HTML)은 건너뛴다.
{
  const nameToAlias = new Map();
  for (const name of [...customerNames].filter((n) => n.length >= 5)) {
    nameToAlias.set(name, aliasOf('', name).name);
  }
  // 실명도 하나의 교대 정규식으로 합친다. 긴 이름이 먼저 매칭되도록 길이 내림차순.
  const escapedNames = [...nameToAlias.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  const fullNameRegex = escapedNames.length
    ? new RegExp(`(?<![A-Za-z0-9_$])(?:${escapedNames.join('|')})(?![A-Za-z0-9_$])`, 'gi')
    : null;

  const scrubString = (value) => {
    const replaced = fullNameRegex
      ? value.replace(fullNameRegex, (hit) => nameToAlias.get(normName(hit)) || hit)
      : value;
    return scrubBrands(replaced);
  };
  const walk = (node) => {
    if (typeof node === 'string') return scrubString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  let scrubbed = 0;
  for (const m of [...html.matchAll(/[A-Za-z0-9+/=]{20000,}/g)].reverse()) {
    let parsed;
    try {
      parsed = JSON.parse(decodeGz(m[0]));
    } catch {
      continue; // gzip 아님 또는 JSON 아님 (폰트·안내 HTML)
    }
    const rewritten = encodeGz(JSON.stringify(walk(parsed)));
    if (rewritten !== m[0]) {
      html = html.slice(0, m.index) + rewritten + html.slice(m.index + m[0].length);
      scrubbed++;
    }
  }
  console.log(`잔여 블롭 소거 — ${scrubbed}개 블록 재작성`);
}

/* ============================================================
   3단계 — 평문 리터럴 마스킹
   ============================================================ */

// 극판 단가: {"SLI00040":["이름",폭,높이,"두께",기판중량,활물질,단가]} 의 idx 6
{
  const m = html.match(/var BD_PLATE=\{[^;]+\};/);
  if (!m) throw new Error('BD_PLATE 를 찾지 못했습니다');
  const obj = JSON.parse(m[0].slice('var BD_PLATE='.length, -1));
  const costs = Object.values(obj).map((r) => r[6]).filter((v) => v > 0).sort((a, b) => a - b);
  const median = costs[Math.floor(costs.length / 2)];
  for (const code of Object.keys(obj)) obj[code][6] = Math.round((obj[code][6] / median) * 100) / 100;
  html = html.replace(m[0], `var BD_PLATE=${JSON.stringify(obj)};`);
  console.log(`극판 단가 상대화 완료 — ${costs.length}종 (중앙값=1.00)`);
}

// 액션 대시보드의 고객 요약 15개사 (평문 리터럴)
{
  const m = html.match(/var top15=\[.*?\];/s);
  if (!m) throw new Error('top15 리터럴을 찾지 못했습니다');
  const arr = JSON.parse(m[0].slice('var top15='.length, -1));
  const median = [...arr.map((x) => x.revenue)].sort((a, b) => a - b)[Math.floor(arr.length / 2)] || 1;
  const masked = arr.map((x) => ({
    name: aliasOf('', x.name).name,
    revenue: Math.round((x.revenue / median) * 100 * 10) / 10,
    margin: bandRatePercent(x.margin),
    products: x.products,
    share: Math.round(x.share),
  }));
  html = html.replace(m[0], `var top15=${JSON.stringify(masked)};`);
  console.log('고객 요약(top15) 마스킹 완료 — 매출 중앙값=100, 마진 5%p 구간');
}

// 챗봇 한→영 고객명 별칭 사전: 한글 키 자체가 고객명이므로 비운다.
{
  const m = html.match(/var KOBUYER=\{[^}]+\};/);
  if (!m) throw new Error('KOBUYER 리터럴을 찾지 못했습니다');
  html = html.replace(m[0], 'var KOBUYER={};');
  console.log('챗봇 고객명 별칭 사전 제거');
}

// UI 예시 문구에 박힌 고객 브랜드(검색창 placeholder 등).
// 데이터가 아니라 화면 문구라 앞의 브랜드 소거가 닿지 않는다.
{
  const before = html;
  html = html.replace(/예\)\s*SEBANG/gi, '예) 고객사-0001');
  if (html !== before) console.log('UI 예시 문구의 고객명 치환');
}

// 데이터시트 인쇄 푸터의 자사명. 시연본에서는 중립 문구로 바꾼다.
{
  const before = html;
  html = html.replace(/Sebang\s+Global\s+battery\s+co\.,\s+Ltd/gi, 'DEMO Battery Co., Ltd');
  if (html !== before) console.log('데이터시트 자사명 → DEMO Battery Co., Ltd');
}

// 액션 대시보드의 나머지 고객 리터럴: {"buyer":"NASEEM", ...} 형태가 여러 배열에 흩어져 있다.
// 키 이름으로 찾아 값만 익명화한다(구조·수치는 그대로 두어 화면이 살아 있게).
{
  let count = 0;
  html = html.replace(/"buyer"\s*:\s*"([^"]+)"/g, (_, name) => {
    count++;
    return `"buyer":"${aliasOf('', name).name}"`;
  });
  // top15 외에 {"name": ...} 형태로 고객이 들어간 리터럴도 같은 사전으로 익명화한다.
  html = html.replace(/\{"name":"([^"]+)","revenue":/g, (_, name) => {
    count++;
    return `{"name":"${aliasOf('', name).name}","revenue":`;
  });
  console.log(`대시보드 고객 리터럴 익명화 — ${count}곳`);
}

// 남은 평문 실명(데이터시트 푸터·주석·예시) — 전체 이름만 치환한다. 식별자는 건드리지 않는다.
{
  let hits = 0;
  // 5자 이상이면 치환한다. (초기 구현은 8자 이상만 처리해 MONBAT·NASEEM 같은 짧은 상호가 남았다)
  const plainNames = [...customerNames].filter((n) => n.length >= 5).sort((a, b) => b.length - a.length);
  const plainAlias = new Map(plainNames.map((n) => [n, aliasOf('', n).name]));
  const plainEscaped = plainNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  // 경계 가드가 필요한 이유와, 길이로 규칙을 나누는 이유:
  //  · 짧은 이름은 코드에 우연히 박힌다. 'FOREX' 가 normalizeTableForExcel 의 'ForEx' 에 걸려
  //    함수 이름을 깨뜨린 적이 있다 → 앞뒤 모두 가드.
  //  · 긴 이름은 DB 에서 20자로 잘려 저장된 것이 많아('SEBANG GLOBAL BATTER'), 실제 문서에는
  //    뒤에 글자가 더 붙는다('...battery co., Ltd') → 뒤 가드를 걸면 못 잡는다. 앞 가드만.
  const SHORT_NAME_MAX = 12;
  const guardedPattern = (escaped, name) =>
    name.length < SHORT_NAME_MAX ? `(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])` : `(?<![A-Za-z0-9_$])${escaped}`;
  const plainGuarded = plainNames.map((n, i) => guardedPattern(plainEscaped[i], n));
  if (plainGuarded.length) {
    html = html.replace(new RegExp(`(?:${plainGuarded.join('|')})`, 'gi'), (hit) => {
      hits++;
      return plainAlias.get(normName(hit)) || hit;
    });
  }
  console.log(`평문 실명 치환 — ${hits}곳`);
}

/* ============================================================
   4단계 — 내장 앱 · 계정 · 배너
   ============================================================ */

transformBlob(ANCHORS.portfolio, () =>
  encodeGz(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{font-family:'Malgun Gothic',sans-serif;display:grid;place-items:center;min-height:90vh;background:#f6f7f9;color:#333}div{max-width:420px;text-align:center;background:#fff;border:1px solid #ddd;border-radius:12px;padding:36px}</style></head><body><div><h2>시연용에서는 제공되지 않습니다</h2><p>포트폴리오 모듈은 사내 상세 데이터를 포함하고 있어 마스킹본에서 제외되었습니다. 사내 원본에서 이용해 주세요.</p></div></body></html>`,
  ),
);
console.log('내장 포트폴리오 앱 → 안내 페이지로 교체');

{
  const usersRe = /var USERS=\[\{id:'admin',name:'관리자',role:'admin',pw:'admin123'\}\];/;
  if (!usersRe.test(html)) throw new Error('USERS 리터럴을 찾지 못했습니다 (원본 버전이 다를 수 있음)');
  html = html.replace(usersRe, "var USERS=[{id:'demo',name:'시연',role:'admin',pw:'demo'}];");
  console.log('로그인 계정 demo/demo 로 교체');
}

html = html.replace(/<title>([^<]*)<\/title>/, '<title>$1 · 시연용 마스킹본</title>');
// 리본 삽입 위치 주의: 원본에는 </body> 가 18곳 있고 그중 대부분이 JS 문자열 안이다
// (데이터시트·엑셀 내보내기용 HTML). 게다가 파일이 </body></html> 로 끝나지도 않는다.
// 위치를 찾아 끼우려는 시도는 전부 코드 한복판에 div 를 박아 문법 오류를 냈다.
// 파서가 후행 요소를 body 로 옮겨주므로, 파일 맨 끝에 덧붙이는 것이 가장 안전하다.
html += `\n<style>body{padding-top:26px !important}#bdprs-masked-ribbon{height:26px;box-sizing:border-box}</style>\n<div id="bdprs-masked-ribbon" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7a3b10;color:#ffe1c4;font:600 12px/14px 'Malgun Gothic',sans-serif;text-align:center;padding:6px 10px;pointer-events:none;letter-spacing:.04em">시연용 마스킹본 — 고객명·매출·영업이익·판매수량·단가는 실제 값이 아닙니다</div>\n`;


/* ============================================================
   5단계 — 유출 검증 (압축 블롭 내부까지 전수)
   ============================================================ */

{
  let haystack = html.toUpperCase();
  let blobCount = 0;
  for (const m of html.matchAll(/[A-Za-z0-9+/=]{20000,}/g)) {
    try {
      haystack += decodeGz(m[0]).toUpperCase();
      blobCount++;
    } catch {
      /* 폰트 등 gzip 아닌 블롭은 건너뛴다 */
    }
  }

  // 검증도 치환과 같은 경계 규칙을 쓴다. 단순 includes 로 보면 코드의 forExcel 이
  // 고객명 FOREX 로 오탐되어, 고칠 수 없는 실패로 빌드가 막힌다.
  const nameTargets = [...customerNames].filter((n) => n.length >= 5);
  const leakedNames = nameTargets.filter((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const guard =
      n.length < 12 ? `(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])` : `(?<![A-Za-z0-9_$])${escaped}`;
    return new RegExp(guard, 'i').test(haystack);
  });

  // 금액: 원본 대형 매출액이 그대로 남았는지
  const bigAmounts = positiveAmounts.slice(-2000).filter((v) => v > 1e8).map((v) => String(Math.round(v)));
  const leakedAmounts = bigAmounts.filter((v) => haystack.includes(v));

  const problems = [];
  if (leakedNames.length) problems.push(`실명 ${leakedNames.length}건: ${leakedNames.slice(0, 8).join(', ')}`);
  if (leakedAmounts.length) problems.push(`원본 매출액 ${leakedAmounts.length}건: ${leakedAmounts.slice(0, 5).join(', ')}`);
  if (problems.length) {
    console.error('\n유출 검증 실패 — 파일을 만들지 않습니다:');
    problems.forEach((p) => console.error('  · ' + p));
    process.exit(1);
  }
  console.log(`유출 검증 통과 — 블롭 ${blobCount}개 해제 포함, 실명 ${nameTargets.length}건 · 금액 ${bigAmounts.length}건 모두 부재`);
}

/* ---- 코드 무결성 검증 1: 인라인 스크립트가 원본과 똑같이 파싱되는가 ---- */
// 문자열 치환이 코드를 건드리면 여기서 반드시 걸린다. (실제로 함수명이 깨진 적이 있다)
{
  const original = readFileSync(inFile, 'utf8');
  const scriptsOf = (text) => [...text.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const before = scriptsOf(original);
  const after = scriptsOf(html);
  if (before.length !== after.length) {
    console.error(`\n코드 무결성 실패 — 스크립트 블록 수가 달라졌습니다: ${before.length} → ${after.length}`);
    process.exit(1);
  }
  const parses = (code) => {
    try {
      new vm.Script(code);
      return true;
    } catch {
      return false;
    }
  };
  const broken = [];
  for (let i = 0; i < after.length; i++) {
    if (parses(before[i]) && !parses(after[i])) broken.push(i);
  }
  if (broken.length) {
    console.error(`\n코드 무결성 실패 — 스크립트 ${broken.length}개가 마스킹 후 문법 오류: 블록 ${broken.join(', ')}`);
    process.exit(1);
  }
  console.log(`코드 무결성 통과 — 인라인 스크립트 ${after.length}개 파싱 동일`);
}

/* ---- 코드 무결성 검증 2: 데이터 변수가 그대로 살아 있는가 ---- */
{
  const required = ['SALES_2026_B64', 'buyerDataB64', 'salesDataB64', '__P_B64', 'BD_PLATE', 'PRODYR', 'top15', 'KOBUYER'];
  const missing = required.filter((name) => !html.includes(name));
  if (missing.length) {
    console.error(`\n코드 무결성 실패 — 식별자가 사라졌습니다: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('코드 무결성 통과 — 데이터 식별자 전부 보존');
}

writeFileSync(outFile, html, 'utf8');
const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
console.log(`\n마스킹본 저장 → ${outFile}`);
console.log(`  ${mb(originalSize)} → ${mb(html.length)} · 고객 익명화 ${aliasSeq}개사`);
