/* battery_catalog.html 안의 시드 데이터를 JSON 으로 뽑는다.
   엑셀 워크북(tools/build_workbook.py)이 이 JSON 을 먹는다.

   사용법:  node tools/dump_seed.js battery_catalog.html seed.json          */
const fs = require('fs');

const src = process.argv[2] || 'battery_catalog.html';
const out = process.argv[3] || 'seed.json';

const html = fs.readFileSync(src, 'utf8');
// <script> 안에서 시드 블록만 잘라낸다 — 앱 로직은 DOM 이 필요해서 평가하지 않는다.
const start = html.indexOf('const SEED_VERSION');
const end = html.indexOf('/* ===========================================================================\n   앱 로직');
if (start < 0 || end < 0) {
  console.error('시드 블록을 찾지 못했다. battery_catalog.html 구조가 바뀌었는지 확인할 것.');
  process.exit(1);
}
const code = html.slice(start, end).replace(/^const /gm, 'var ');
eval(code);

fs.writeFileSync(out, JSON.stringify(
  {SPECS, MAKERS, MODELS, FITMENT, REGIONS, TECHS, APPS, SEED_VERSION}, null, 1));
console.log('모델 %d · 규격 %d · 제조사 %d · 차종 %d → %s',
  MODELS.length, SPECS.length, MAKERS.length, FITMENT.length, out);
