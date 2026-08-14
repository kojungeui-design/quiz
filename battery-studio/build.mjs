/**
 * build.mjs — 의존성 없는 빌드. node 하나만 있으면 돌아간다.
 *
 *   node build.mjs              HTML 파일 하나 생성 (데이터 포함, 더블클릭하면 바로 열림)
 *   node build.mjs --masked     시연용 마스킹 데이터로 생성
 *   node build.mjs --split      데이터를 data/bds-db.js 로 분리 (DB만 따로 갱신할 때)
 *
 * 데이터는 소스에서는 data/source/*.json 으로 분리해 관리하고, 빌드할 때 HTML 안에 넣는다.
 * 그래야 관리는 분리된 채로 두면서 배포는 파일 하나로 끝난다.
 *
 * 방식: src/ 의 ES 모듈들을 의존 순서대로 이어 붙여 하나의 스코프에 넣는다.
 *   import/export 구문만 제거하면 되므로 파서가 필요 없다. 대신 모듈 간 최상위 이름이
 *   겹치면 조용히 덮어써지므로, 아래 checkCollisions()가 빌드를 멈춘다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, 'src');
const DIST = resolve(here, 'dist');

const masked = process.argv.includes('--masked');
const inlineData = !process.argv.includes('--split'); // 기본은 단일 파일

/* ---------------------- 1. 모듈 그래프 ---------------------- */

const IMPORT_RE = /^\s*import\s+[^'"]*from\s*['"]([^'"]+)['"];?\s*$/gm;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"];?\s*$/gm;

const modules = new Map(); // 절대경로 → { source, deps }

function load(path) {
  if (modules.has(path)) return;
  if (!existsSync(path)) throw new Error(`모듈을 찾을 수 없습니다: ${path}`);
  const source = readFileSync(path, 'utf8');
  const deps = [];
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      if (!match[1].startsWith('.')) throw new Error(`외부 패키지는 쓸 수 없습니다: ${match[1]} (${path})`);
      deps.push(resolve(dirname(path), match[1]));
    }
  }
  modules.set(path, { source, deps });
  deps.forEach(load);
}

const ENTRY = resolve(SRC, 'main.js');
load(ENTRY);

// 위상 정렬: 의존 대상이 항상 먼저 오도록
const ordered = [];
const visiting = new Set();
const done = new Set();
(function visit(path, stack) {
  if (done.has(path)) return;
  if (visiting.has(path)) throw new Error(`순환 참조: ${[...stack, path].map((p) => relative(SRC, p)).join(' → ')}`);
  visiting.add(path);
  for (const dep of modules.get(path).deps) visit(dep, [...stack, path]);
  visiting.delete(path);
  done.add(path);
  ordered.push(path);
})(ENTRY, []);

/* ---------------------- 2. import/export 제거 ---------------------- */

function stripModuleSyntax(source) {
  return source
    .replace(IMPORT_RE, '')
    .replace(BARE_IMPORT_RE, '')
    // `export { a, b };` 처럼 재수출만 하는 줄은 통째로 제거
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
    // `export const x` / `export function f` / `export class C` → 선언만 남긴다
    .replace(/^(\s*)export\s+(const|let|var|function|async function|class)\s/gm, '$1$2 ');
}

/** 한 스코프에 합치므로 최상위 이름이 겹치면 안 된다. */
function checkCollisions(files) {
  const DECL_RE = /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm;
  const owner = new Map();
  const collisions = [];
  for (const { path, code } of files) {
    DECL_RE.lastIndex = 0;
    let match;
    while ((match = DECL_RE.exec(code))) {
      const name = match[1];
      if (owner.has(name)) collisions.push(`${name} — ${owner.get(name)} 와 ${relative(SRC, path)}`);
      else owner.set(name, relative(SRC, path));
    }
  }
  if (collisions.length) {
    console.error('\n최상위 이름이 겹칩니다. 한쪽 이름을 바꿔주세요:\n');
    collisions.forEach((line) => console.error('  · ' + line));
    process.exit(1);
  }
}

const files = ordered.map((path) => ({ path, code: stripModuleSyntax(modules.get(path).source).trim() }));
checkCollisions(files);

/**
 * 인라인 <script> 안에서는 `</script` 라는 글자가 스크립트를 끝내버린다.
 * 문자열이든 주석이든 상관없이 HTML 파서가 먼저 자르므로, 내보내기 직전에 무해하게 바꾼다.
 */
const escapeForInlineScript = (code) => code.replace(/<\/(script)/gi, '<\\/$1');

const bundle = escapeForInlineScript(
  [
    '(() => {',
    '"use strict";',
    ...files.map(({ path, code }) => `\n/* ===== ${relative(SRC, path).replace(/\\/g, '/')} ===== */\n${code}`),
    '})();',
  ].join('\n'),
);

/* ---------------------- 3. HTML 조립 ---------------------- */

const css = readFileSync(resolve(SRC, 'styles', 'app.css'), 'utf8');
const dataFile = masked ? 'bds-db.masked.js' : 'bds-db.js';
const dataPath = resolve(here, 'data', 'generated', dataFile);
// 데이터가 아직 없으면 알아서 만든다. 빌드 순서를 외우지 않아도 되게.
if (!existsSync(dataPath)) {
  console.log('설계 DB를 먼저 준비합니다…');
  execFileSync(process.execPath, ['data/build-db.mjs', ...(masked ? ['--masked'] : [])], { cwd: here, stdio: 'inherit' });
}

const dataScript = inlineData
  ? `<script>${escapeForInlineScript(readFileSync(dataPath, 'utf8'))}</script>`
  : `<script src="data/${dataFile}"></script>`;

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="배터리 제품군의 목표 성능·극판 호환성·공용화·원가를 비교하는 오프라인 설계 도구">
<meta name="robots" content="noindex,nofollow">
<title>Battery Design Studio v8 · 제품개발 워크벤치</title>
<style>${css}</style>
</head>
<body>
<div id="app"><noscript>이 프로그램은 자바스크립트가 필요합니다. 브라우저 설정에서 자바스크립트를 켜주세요.</noscript></div>
${dataScript}
<script>${bundle}</script>
</body>
</html>
`;

mkdirSync(DIST, { recursive: true });
const outName = masked ? '배터리설계스튜디오_시연용.html' : '배터리설계스튜디오.html';
const outFile = resolve(DIST, outName);
writeFileSync(outFile, html, 'utf8');

// 데이터 분리 배포일 때만 dist 에 데이터 파일을 함께 둔다.
if (!inlineData) {
  mkdirSync(resolve(DIST, 'data'), { recursive: true });
  writeFileSync(resolve(DIST, 'data', dataFile), readFileSync(dataPath, 'utf8'), 'utf8');
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`\n빌드 완료 → dist\\${outName}`);
console.log(`  모듈 ${files.length}개 · 스크립트 ${kb(bundle.length)} · 스타일 ${kb(css.length)} · 전체 ${kb(html.length)}`);
if (inlineData) {
  console.log(`  데이터 포함${masked ? ' (마스킹본)' : ''} — 이 HTML 파일 하나만 있으면 됩니다.`);
  console.log('  더블클릭하면 브라우저에서 바로 열립니다.');
} else {
  console.log(`  데이터 분리 — dist\\data\\${dataFile} 와 함께 전달해야 합니다.`);
}
