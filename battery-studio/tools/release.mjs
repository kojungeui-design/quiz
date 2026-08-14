/**
 * tools/release.mjs — 빌드하기.bat 이 부르는 전체 절차.
 *
 * 한글 안내는 전부 여기(node)에서 출력한다. .bat 안에 한글을 두면 cmd가 시스템 코드페이지로
 * 읽어 깨지기 때문이다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

const skipTests = process.argv.includes('--skip-tests');
const line = (char = '─') => console.log(char.repeat(52));

console.log();
line('═');
console.log('  배터리 설계 스튜디오 v8 — 빌드');
line('═');

try {
  console.log('\n[1/4] 설계 DB 준비');
  run(['data/build-db.mjs']);
  run(['data/build-db.mjs', '--masked']);

  if (skipTests) {
    console.log('\n[2/4] 검증 건너뜀 (--skip-tests)');
  } else {
    console.log('\n[2/4] 검증 — 구엔진 대조 · 화면 동작');
    run(['--test', 'test/parity.test.mjs', 'test/bugfix.test.mjs', 'test/app-smoke.test.mjs']);
  }

  console.log('\n[3/4] 프로그램 생성');
  run(['build.mjs']);
  run(['build.mjs', '--masked']);

  if (!skipTests) {
    // 소스가 아니라 방금 만든 HTML을 직접 실행해 본다. 빌드 과정에서 깨졌는지 여기서 잡힌다.
    console.log('\n[4/4] 배포본 확인 — 만들어진 HTML을 직접 실행');
    run(['--test', 'test/build.test.mjs']);
    run(['build.mjs', '--masked']); // 확인 과정에서 덮인 시연용 파일을 다시 만든다
  }
} catch {
  console.error('\n' + '─'.repeat(52));
  console.error('  빌드를 멈췄습니다. 위에 표시된 오류를 확인하세요.');
  console.error('  검증 실패라면 계산 결과가 달라졌다는 뜻이므로,');
  console.error('  원인을 찾기 전에는 배포하지 마세요.');
  console.error('─'.repeat(52));
  process.exit(1);
}

const dist = resolve(root, 'dist');
const main = resolve(dist, '배터리설계스튜디오.html');
const demo = resolve(dist, '배터리설계스튜디오_시연용.html');
const mb = (path) => (existsSync(path) ? (statSync(path).size / 1024 / 1024).toFixed(2) + ' MB' : '없음');

console.log();
line('═');
console.log('  완료');
line('═');
console.log(`\n  사내용    dist\\배터리설계스튜디오.html        (${mb(main)})`);
console.log(`  시연용    dist\\배터리설계스튜디오_시연용.html  (${mb(demo)})`);
console.log('\n  HTML 파일 하나만 옮기면 됩니다. 더블클릭하면 브라우저에서 열립니다.');
console.log('  사내용 파일에는 극판 단가와 판매수량이 들어 있습니다. 사외 반출 금지.');
console.log();

// 탐색기로 dist 폴더를 열어준다(실패해도 빌드 결과에는 영향 없음).
if (process.platform === 'win32') {
  try {
    execFileSync('explorer.exe', [dist], { stdio: 'ignore' });
  } catch {
    /* explorer는 종료코드 1을 흔히 반환한다. 무시한다. */
  }
}
