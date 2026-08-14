/**
 * data/build-db.mjs
 * source/*.json  →  dist/data/bds-db.js
 *
 * 왜 JSON이 아니라 .js 파일로 내보내는가:
 *   앱 HTML을 file:// 로 열면 fetch()는 브라우저 CORS 정책에 막혀 로컬 JSON을 읽지 못한다.
 *   <script src="data/bds-db.js"> 는 file:// 에서도 동작하므로, 데이터를 전역 할당 스크립트로 만든다.
 *
 * 사용:
 *   node data/build-db.mjs           사내용 (실데이터)
 *   node data/build-db.mjs --masked  외부 시연용 (단가·판매수량 마스킹)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (name) => JSON.parse(readFileSync(resolve(here, 'source', name), 'utf8'));

const masked = process.argv.includes('--masked');

const plates = read('plates.json');
const products = read('products.json');
const salesQty = read('sales-qty.json');
const groupOrder = read('group-order.json');
const meta = read('meta.json');

/* ---------- 정합성 검사: 깨진 데이터를 배포에 싣지 않는다 ---------- */
const problems = [];
const plateByCode = new Map(plates.map((p) => [p.code, p]));

for (const p of plates) {
  if (!p.code) problems.push(`극판 코드 누락: ${JSON.stringify(p).slice(0, 80)}`);
  if (!(p.width > 0) || !(p.height > 0)) problems.push(`극판 ${p.code} 치수 이상`);
  if (!(p.cost >= 0)) problems.push(`극판 ${p.code} 단가 이상`);
}
const seenProduct = new Set();
for (const p of products) {
  if (seenProduct.has(p.code)) problems.push(`제품 코드 중복: ${p.code}`);
  seenProduct.add(p.code);
  if (!plateByCode.has(p.posCode)) problems.push(`제품 ${p.code}: 양극 ${p.posCode} 미등록`);
  if (!plateByCode.has(p.negCode)) problems.push(`제품 ${p.code}: 음극 ${p.negCode} 미등록`);
  if (!(p.assembly > 0)) problems.push(`제품 ${p.code}: 조립매수 이상`);
}
for (const code of Object.keys(salesQty)) {
  if (!seenProduct.has(code)) problems.push(`판매수량에만 있는 코드: ${code}`);
}
if (problems.length) {
  console.error(`\n데이터 정합성 오류 ${problems.length}건 — 빌드를 중단합니다.\n`);
  problems.slice(0, 20).forEach((x) => console.error('  · ' + x));
  if (problems.length > 20) console.error(`  … 외 ${problems.length - 20}건`);
  process.exit(1);
}

/* ---------- 마스킹 (외부 시연용) ---------- */
let outPlates = plates;
let outSales = salesQty;
if (masked) {
  // 단가는 제품군 내 상대비율만 남도록 기준값으로 정규화, 판매수량은 구간화한다.
  const median = [...plates.map((p) => p.cost)].sort((a, b) => a - b)[Math.floor(plates.length / 2)];
  outPlates = plates.map((p) => ({ ...p, cost: Math.round((p.cost / median) * 100) / 100 }));
  outSales = Object.fromEntries(
    Object.entries(salesQty).map(([code, qty]) => [code, qty >= 10000 ? 10000 : qty >= 1000 ? 1000 : 100]),
  );
}

const db = {
  schema: 'bds-db-v1',
  builtAt: new Date().toISOString().slice(0, 10),
  masked,
  meta: { ...meta, plates: outPlates.length, uniqueDesigns: products.length, groups: groupOrder.length },
  groupOrder,
  plates: outPlates,
  products,
  salesQty: outSales,
};

// dist 에는 최종 결과물만 두고, 중간 산출물은 여기(data/generated)에 남긴다.
const outDir = resolve(here, 'generated');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, masked ? 'bds-db.masked.js' : 'bds-db.js');
const banner = masked
  ? '/* Battery Design Studio DB — 시연용 마스킹본. 단가·판매수량은 실제 값이 아닙니다. */\n'
  : '/* Battery Design Studio DB — 사내 대외비. 외부 반출 금지. */\n';
writeFileSync(outFile, banner + 'window.BDS_DB = ' + JSON.stringify(db) + ';\n', 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`${masked ? '[마스킹] ' : ''}데이터 준비 완료 → ${outFile.replace(root + '\\', '')}`);
console.log(`  제품 ${products.length} · 극판 ${outPlates.length} · 제품군 ${groupOrder.length} · 판매수량 ${Object.keys(outSales).length}`);
console.log(`  크기 ${kb(readFileSync(outFile).length)}`);
