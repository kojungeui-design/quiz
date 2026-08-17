/**
 * src/main.js — 진입점.
 *
 * 데이터는 window.BDS_DB 로 들어온다. 기본 빌드는 HTML 안에 인라인으로 심고,
 * --split 배포일 때만 data/bds-db.js 를 script 태그로 불러온다.
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
    /**
     * 안내문은 실제 배포 형태와 맞아야 한다. 기본 빌드는 DB를 HTML 안에 넣으므로
     * "data 폴더를 함께 복사하라"는 옛 안내는 없는 폴더를 찾게 만든다.
     * (--split 로 데이터를 분리한 배포일 때만 옆 파일이 필요하다)
     */
    showFatal(root, '내장 데이터를 불러오지 못했습니다', [
      '이 HTML 파일 하나에 설계 DB가 들어 있습니다. 따로 챙길 파일은 없습니다.',
      '메일·메신저로 받는 과정에서 파일이 잘렸을 수 있습니다. 원본을 다시 받아 열어보세요.',
      '사내 보안 프로그램이 스크립트를 막고 있을 수도 있습니다. 다른 브라우저로 열어보세요.',
      '데이터를 분리한 배포본(dist/data 폴더 동봉)이라면 그 폴더째 함께 복사해야 합니다.',
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
