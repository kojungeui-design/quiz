// index.html 에 실제로 들어 있는 감지 로직을 그대로 뽑아 실행하는 검사기.
//
// 복사본을 두면 원본과 슬그머니 어긋나므로, 파일에서 함수와 상수를 직접 추출한다.
// 캔버스가 없는 Node 에서 돌리기 위해 픽셀은 파이썬이 미리 축소해 넘겨준다.
//
//   node browser_detect_harness.js <index.html> <manifest.json>
//   → 케이스별 결과를 JSON 으로 표준출력에 뱉는다.
'use strict';
const fs = require('fs');
const path = require('path');

const [htmlPath, manifestPath] = process.argv.slice(2);
const html = fs.readFileSync(htmlPath, 'utf8');

// --- index.html 에서 함수 하나를 통째로 떼어 온다 (중괄호 짝 맞추기) ---------
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`index.html 에서 ${name}() 을 찾지 못했습니다`);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name}() 의 끝을 찾지 못했습니다`);
}

function constant(name) {
  const m = html.match(new RegExp(`${name}\\s*=\\s*([\\d.]+)`));
  if (!m) throw new Error(`index.html 에서 상수 ${name} 을 찾지 못했습니다`);
  return parseFloat(m[1]);
}

const CONSTS = ['INK_GRID', 'INK_FLOOR', 'INK_REL', 'INK_SCALE',
                'REGION_GRID', 'REGION_DELTA', 'REGION_SCALE'];
const values = Object.fromEntries(CONSTS.map(n => [n, constant(n)]));

const factory = new Function(
  ...CONSTS,
  extractFunction(html, 'inkMapFromPixels') + '\n' +
  extractFunction(html, 'sigDiff') + '\n' +
  'return { inkMapFromPixels, sigDiff };'
);
const { inkMapFromPixels, sigDiff } = factory(...CONSTS.map(n => values[n]));

// --- 파이썬이 덤프한 픽셀 읽기 ---------------------------------------------
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { edge: EDGE, colorSize, cases } = manifest;
const dir = path.dirname(manifestPath);

const COLOR_BYTES = colorSize * colorSize * 4;
const EDGE_BYTES = EDGE * EDGE * 4;
const REGION_BYTES = values.REGION_GRID * values.REGION_GRID * 4;

function loadSide(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const expected = COLOR_BYTES + EDGE_BYTES + REGION_BYTES;
  if (buf.length !== expected) {
    throw new Error(`${file}: ${buf.length} 바이트, ${expected} 를 기대했습니다`);
  }
  const color = new Uint8ClampedArray(buf.buffer, buf.byteOffset, COLOR_BYTES);
  const edgePx = new Uint8ClampedArray(buf.buffer, buf.byteOffset + COLOR_BYTES, EDGE_BYTES);
  const region = new Uint8ClampedArray(buf.buffer, buf.byteOffset + COLOR_BYTES + EDGE_BYTES, REGION_BYTES);
  return { color, ink: inkMapFromPixels(edgePx, EDGE, EDGE, values.INK_GRID), region };
}

const results = cases.map(c => ({
  label: c.label,
  want: c.want,
  value: sigDiff(loadSide(c.a), loadSide(c.b)),
}));

process.stdout.write(JSON.stringify({ constants: values, results }));
