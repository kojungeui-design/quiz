/**
 * src/main.js — 진입점.
 *
 * 데이터는 data/bds-db.js 를 script 태그로 먼저 불러와 window.BDS_DB 에 들어온다.
 * file:// 로 열어도 동작하도록 fetch가 아니라 script 태그를 쓴다.
 */
import { h } from './lib/dom.js';
import { startApp } from './app.js';

function showFatal(root, title, lines) {
  root.replaceChildren(
    h(
      'div.fatal',
      null,
      h('h1', null, title),
      ...lines.map((line) => h('p', null, line)),
    ),
  );
}

function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  const db = globalThis.BDS_DB;
  if (!db || !Array.isArray(db.products) || !Array.isArray(db.plates)) {
    showFatal(root, '데이터 파일을 불러오지 못했습니다', [
      '이 프로그램은 같은 폴더의 data/bds-db.js 파일이 있어야 동작합니다.',
      'HTML 파일만 따로 복사하면 열리지 않습니다. data 폴더째 함께 복사해 주세요.',
      '파일을 옮긴 적이 없다면 압축을 다시 풀고 실행해 보세요.',
    ]);
    return;
  }

  try {
    startApp(root, db);
  } catch (error) {
    console.error(error);
    showFatal(root, '프로그램을 시작하지 못했습니다', [
      String(error?.message || error),
      '브라우저를 새로고침해도 같은 문제가 나오면 이 메시지를 그대로 담당자에게 전달해 주세요.',
    ]);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
