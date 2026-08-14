/**
 * test/tools/extract-legacy-engine.mjs
 *
 * 구버전 번들(Battery_Design_Studio_Professional_v7_사용자친화.html)에서 계산 엔진 부분만
 * 도려내 실행 가능한 모듈로 만든다. 오직 신엔진과의 수치 대조(parity)를 위한 것이며,
 * 앱 빌드에는 전혀 포함되지 않는다.
 *
 *   node test/tools/extract-legacy-engine.mjs
 *   → test/fixtures/legacy-engine.generated.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const LEGACY_HTML = resolve(root, '..', 'Battery_Design_Studio_Professional_v7_사용자친화.html');

const html = readFileSync(LEGACY_HTML, 'utf8');
const bundle = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/** 문자열 리터럴을 건너뛰며 짝이 맞는 괄호를 찾는다. */
function matchBracket(s, start) {
  const open = s[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced bracket from ' + start);
}

function literalAfter(marker) {
  const at = bundle.indexOf(marker);
  if (at < 0) throw new Error('marker not found: ' + marker);
  let open = at;
  while (bundle[open] !== '[' && bundle[open] !== '{') open++;
  return bundle.slice(open, matchBracket(bundle, open) + 1);
}

// 데이터 리터럴 (번들 안 최소화된 형태 그대로)
const dataDefs = [
  ['Ya', literalAfter('var Ya={products:')],
  ['il', literalAfter('il=[{code:"SLI')],
  ['Ye', literalAfter('Ye=[{code:"PC')],
  ['Ce', literalAfter('Ce={PC')],
]
  .map(([name, literal]) => `var ${name} = ${literal};`)
  .join('\n');

// 엔진 본문: `var Ns="v5.3-existing-match"` 부터 sample lineup 직전까지
const engineStart = bundle.indexOf('var Ns="v5.3-existing-match"');
const engineEnd = bundle.indexOf('pl=[{id:"LN1"');
if (engineStart < 0 || engineEnd < 0 || engineEnd <= engineStart) {
  throw new Error(`engine slice not found (start=${engineStart}, end=${engineEnd})`);
}
// 뒤따르는 `var pl=[...` 선언은 엔진이 아니므로 잘라낸다.
// 번들에 따라 `}var pl=` 또는 `},pl=` 형태라 공백·쉼표·var 키워드를 모두 되짚어 제거한다.
let sliceEnd = engineEnd;
for (;;) {
  const before = sliceEnd;
  while (bundle[sliceEnd - 1] === ',' || /\s/.test(bundle[sliceEnd - 1])) sliceEnd--;
  if (bundle.slice(sliceEnd - 3, sliceEnd) === 'var') sliceEnd -= 3;
  if (sliceEnd === before) break;
}
const engineBody = bundle.slice(engineStart, sliceEnd) + ';';

const out = `/* 자동 생성 파일 — 편집하지 마세요.
 * 생성: node test/tools/extract-legacy-engine.mjs
 * 출처: Battery_Design_Studio_Professional_v7_사용자친화.html (엔진 v5.3-existing-match)
 * 용도: 신엔진 이식 결과의 수치 대조 전용. 앱 빌드에 포함되지 않습니다.
 */
${dataDefs}
${engineBody}
export { Ye, il, Ce, Ya, so, Ns, fl, pa, Bn, rm, Cm, bi, An, Ai, Sn, Za, Pn, Es, Gs, hn, z2, vi, Pi, gm, fm, pm, rl, k2, Bi, ua, bn, E2, vn, W, Ts, F2 };
`;

mkdirSync(resolve(root, 'test', 'fixtures'), { recursive: true });
const outFile = resolve(root, 'test', 'fixtures', 'legacy-engine.generated.mjs');
writeFileSync(outFile, out, 'utf8');
console.log(`구엔진 추출 완료 → ${outFile}`);
console.log(`  데이터 ${(dataDefs.length / 1024).toFixed(0)} KB · 엔진 ${(engineBody.length / 1024).toFixed(0)} KB`);
