/**
 * bdprs-tools/capture-shots.mjs — 사용가이드에 들어갈 화면 그림을 자동으로 찍는다.
 *
 *   node capture-shots.mjs <배터리설계스튜디오.html> <출력폴더>
 *
 * 왜 스크립트인가: 손으로 찍으면 화면이 바뀔 때마다 어느 그림이 옛것인지 알 수 없다.
 * 여기서 찍으면 빌드 → 캡처 → 가이드 생성이 한 줄로 이어지고, 가이드가 항상 최신 화면을 담는다.
 *
 * 마스킹본(시연용)으로 찍는 것을 권장한다. 가이드는 사내 배포용이라 고객명·단가가
 * 그림으로 새어 나가면 회수할 방법이 없다.
 *
 * 필요: playwright + chromium (이 컨테이너는 /opt/pw-browsers 에 있다)
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const [, , htmlArg, outArg] = process.argv;
if (!htmlArg || !outArg) {
  console.error('사용법: node capture-shots.mjs <배터리설계스튜디오.html> <출력폴더>');
  process.exit(1);
}
const HTML = 'file://' + resolve(htmlArg);
const OUT = resolve(outArg);
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--lang=ko-KR'],
});
const page = await browser.newPage({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

const settle = () => page.waitForTimeout(450);

/** 화면 전체 또는 지정한 영역 하나를 jpg 로 남긴다. */
async function shot(name, selector) {
  await settle();
  const target = selector ? page.locator(selector).first() : page;
  if (selector && !(await target.count())) {
    problems.push(`${name}: ${selector} 를 찾지 못해 건너뜀`);
    return;
  }
  await target.screenshot({ path: resolve(OUT, name), quality: 82, type: 'jpeg' });
  console.log('  · ' + name);
}

const nav = async (label) => { await page.locator(`.nav-item:has-text("${label}")`).first().click(); await settle(); };
const press = async (label) => { await page.locator(`button:has-text("${label}")`).first().click(); await settle(); };

await page.goto(HTML);
await settle();

console.log('화면 캡처 중…');

/* 01 — 아무것도 없는 첫 화면 */
await shot('01-workbench-empty.jpg');

/* 02 — 과제를 만들면 나오는 요구사양 화면 */
await press('새 과제 시작');
await shot('02-requirements.jpg');

/* 03b — 과제 정보를 채운 상태 */
const fill = async (label, value) => {
  const box = page.locator(`label:has-text("${label}") input`).first();
  if (await box.count()) { await box.fill(value); await box.dispatchEvent('change'); }
};
await fill('과제명', '2026 유럽 EFB 라인업');
await fill('고객', 'EU OEM');
await fill('RFQ / CR 번호', 'RFQ-2026-118');
await fill('담당자', '고정의');
await settle();
await shot('03b-requirements-filled.jpg');

/* 04 — 제품을 하나 더 붙인 라인업 */
await press('제품 추가');
await shot('04-lineup-2products.jpg');

/* 05 — 기존 제품 매칭. 단계 이동 버튼으로 가야 계산이 함께 돌아간다. */
await press('기존 PCC 매칭으로 이동');
await shot('05-matching.jpg');

/* 06·07·07b — 설계안 비교 / BOM / 실시간 조절 */
await press('설계·BOM 비교로 이동');
if (!(await page.locator('.plan-grid').count())) await nav('설계·BOM·공용화');
await shot('06-design.jpg');
await shot('07-design-scroll.jpg', '.card:has(.data-table)');
await shot('15-separator-bom.jpg', '.card:has(.data-table)');

const whatif = page.locator('.whatif-card');
if (await whatif.count()) {
  await shot('07b-whatif-base.jpg', '.whatif-card');
  // 조절한 뒤 모습도 남긴다 — "무엇이 바뀌는지"가 이 카드의 전부이기 때문이다.
  const sliders = page.locator('.whatif-range');
  const bump = async (i, value) => {
    await sliders.nth(i).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
    await page.waitForTimeout(150);
  };
  await bump(2, await sliders.nth(2).getAttribute('max'));
  await bump(3, Number(await sliders.nth(3).inputValue()) + 2);
  await shot('07c-whatif-tuned.jpg', '.whatif-card');
  await shot('07d-whatif-lineup.jpg', '.whatif-lineup');
  await page.locator('.whatif-card button:has-text("기준값으로 되돌리기")').click();
  await settle();
} else {
  problems.push('실시간 조절 카드가 설계 화면에 없다');
}

await shot('07e-consolidation.jpg', '.consol-card');

/* 08 — 원가·수익성 */
await nav('원가·수익성');
await shot('08-costing.jpg');

/* 09·10 — 보고서 */
await nav('보고서·출력');
await shot('09-report.jpg');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('10-report-bom.jpg');
await page.evaluate(() => window.scrollTo(0, 0));

/* 11·12 — DB 조회와 갱신 */
await nav('제품·극판 DB');
await shot('11-database.jpg');
const importTab = page.locator('button:has-text("DB 갱신"), button:has-text("가져오기"), button:has-text("임포트")').first();
if (await importTab.count()) { await importTab.click(); await settle(); }
await shot('12-db-import.jpg');

/* 13 — 예측 보정 */
await nav('예측 보정');
await shot('13-calibration.jpg');

/* 14 — 과제가 쌓인 워크벤치 */
await nav('개발 워크벤치');
await shot('14-workbench-saved.jpg');

await browser.close();

if (problems.length) {
  console.error('\n확인이 필요합니다:');
  problems.forEach((p) => console.error('  · ' + p));
  process.exit(1);
}
console.log(`\n완료 → ${OUT}`);
