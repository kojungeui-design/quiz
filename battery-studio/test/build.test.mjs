/**
 * test/build.test.mjs — 실제로 배포되는 파일을 검사한다.
 *
 * 소스가 통과해도 빌드 과정(import 제거·이어붙이기)에서 깨질 수 있다.
 * 여기서는 dist의 HTML을 그대로 읽어 스크립트를 실행하고 화면이 뜨는지 확인한다.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installDomStub } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const HTML = resolve(root, 'dist', '배터리설계스튜디오.html');
const SPLIT_DATA = resolve(root, 'dist', 'data', 'bds-db.js');

/** HTML 안의 인라인 스크립트들을 순서대로 뽑는다. */
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

before(() => {
  // 테스트가 오래된 빌드를 검사하지 않도록 항상 새로 빌드한다.
  execFileSync(process.execPath, ['build.mjs'], { cwd: root });
});

test('기본 빌드는 HTML 파일 하나로 끝난다', () => {
  assert.ok(existsSync(HTML), '앱 HTML이 있어야 한다');
  const html = readFileSync(HTML, 'utf8');
  assert.ok(/window\.BDS_DB\s*=/.test(html), '데이터가 HTML 안에 들어 있어야 한다');
  assert.equal([...html.matchAll(/<script[^>]*\bsrc=/g)].length, 0, '외부 파일을 참조하면 안 된다');
  assert.ok(!existsSync(SPLIT_DATA), '기본 빌드는 dist에 데이터 파일을 남기지 않는다');
});

test('빌드된 HTML이 문법 오류 없이 실행되고 화면이 뜬다', () => {
  const dom = installDomStub();
  delete globalThis.BDS_DB;
  const html = readFileSync(HTML, 'utf8');

  // 브라우저와 같은 순서로 실행한다: 데이터 스크립트 → 앱 번들
  const scripts = inlineScripts(html);
  assert.equal(scripts.length, 2, '데이터와 앱, 두 개의 인라인 스크립트여야 한다');
  for (const code of scripts) new Function(code)();

  const text = dom.root.textContent;
  assert.ok(text.includes('제품개발 워크벤치'), `화면이 그려져야 한다. 실제: ${text.slice(0, 120)}`);
  assert.ok(!text.includes('데이터 파일을 불러오지 못했습니다'), '데이터 로드 실패 화면이 뜨면 안 된다');
});

test('데이터가 없으면 사용자에게 이유를 알려준다', () => {
  const dom = installDomStub();
  delete globalThis.BDS_DB;
  // 앱 번들만 실행해 데이터가 없는 상황을 만든다.
  const bundle = inlineScripts(readFileSync(HTML, 'utf8')).at(-1);
  new Function(bundle)();

  const text = dom.root.textContent;
  assert.ok(text.includes('데이터 파일을 불러오지 못했습니다'), '원인을 밝혀야 한다');
});

test('인라인 스크립트를 끊어먹는 </script 문자열이 없다', () => {
  const html = readFileSync(HTML, 'utf8');
  // 실제 종료 태그는 스크립트 블록 끝의 것들뿐이어야 한다.
  const inlineBlocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, code] of inlineBlocks) {
    assert.ok(!/<\/script/i.test(code), '스크립트 본문에 종료 태그 문자열이 남아 있으면 안 된다');
  }
});

test('CSS가 인라인되어 외부 요청이 없다', () => {
  const html = readFileSync(HTML, 'utf8');
  assert.ok(html.includes('<style>'), '스타일이 인라인이어야 한다');
  assert.ok(!/<link[^>]+stylesheet/.test(html), '외부 스타일시트를 참조하면 안 된다');
  assert.ok(!/https?:\/\/(?!schemas\.|www\.w3\.org)/.test(html), '외부 호스트를 부르면 안 된다(완전 오프라인)');
});

test('데이터 분리 빌드(--split)도 동작한다', () => {
  execFileSync(process.execPath, ['build.mjs', '--split'], { cwd: root });
  const html = readFileSync(HTML, 'utf8');
  assert.ok(html.includes('<script src="data/bds-db.js"></script>'), '데이터를 script 태그로 불러와야 한다');
  assert.ok(!html.includes('"SLI00070"'), '극판 코드가 HTML에 직접 들어 있으면 안 된다');
  assert.ok(existsSync(SPLIT_DATA), '데이터 파일이 dist에 함께 놓여야 한다');

  const dom = installDomStub();
  delete globalThis.BDS_DB;
  new Function(readFileSync(SPLIT_DATA, 'utf8'))();
  new Function(inlineScripts(html).at(-1))();
  assert.ok(dom.root.textContent.includes('제품개발 워크벤치'), '분리 배포에서도 화면이 떠야 한다');

  // 기본(단일 파일) 상태로 되돌려 둔다.
  execFileSync(process.execPath, ['build.mjs'], { cwd: root });
  execFileSync(process.execPath, ['-e', 'require("node:fs").rmSync("dist/data",{recursive:true,force:true})'], { cwd: root });
});
