/**
 * test/app-smoke.test.mjs — 화면 코드가 실제로 돌아가는지 확인한다.
 *
 * 7개 화면을 모두 그려보고, 과제 생성 → 입력 → 계산 → 설계안 선택 → 저장까지의 흐름을 태운다.
 * 브라우저 없이 돌기 때문에 매번 `npm test` 로 확인할 수 있다.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));

const db = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};

let dom;
let ctx;
let createLineupItem;
let nextProductName;

before(async () => {
  dom = installDomStub();
  // DOM 스텁을 먼저 설치한 뒤에 앱 모듈을 불러와야 한다.
  const { startApp } = await import('../src/app.js');
  ({ createLineupItem, nextProductName } = await import('../src/core/project.js'));
  ctx = startApp(dom.root, db);
});

const viewText = () => dom.root.textContent;

test('앱이 뜨고 워크벤치가 그려진다', () => {
  assert.ok(viewText().includes('제품개발 워크벤치'), '워크벤치 제목이 보여야 한다');
  assert.ok(viewText().includes('아직 과제가 없습니다'), '처음에는 빈 상태여야 한다');
});

test('새 과제를 만들면 요구사양 화면으로 이동한다', () => {
  ctx.newProject();
  assert.equal(ctx.state.view, 'requirements');
  assert.ok(ctx.project, '현재 과제가 있어야 한다');
  assert.equal(ctx.project.lineup.length, 1);
  assert.ok(viewText().includes('고객 요구사양'));
  assert.ok(viewText().includes('라인업 목표 성능'));
});

test('제품을 추가하면 이름이 겹치지 않는다', () => {
  const { engine } = ctx;
  const group = engine.groups.find((g) => g.currentProducts > 0).group;
  const lineup = ctx.project.lineup;
  const added = [
    ...lineup,
    createLineupItem(engine, group, nextProductName(lineup)),
  ];
  ctx.setLineup(added);
  ctx.setLineup([...ctx.project.lineup, createLineupItem(engine, group, nextProductName(ctx.project.lineup))]);
  const names = ctx.project.lineup.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, `이름 중복: ${names.join(', ')}`);
  assert.equal(new Set(ctx.project.lineup.map((i) => i.uid)).size, names.length, 'uid도 고유해야 한다');
});

test('목표값이 0이면 계산이 시작되지 않는다', () => {
  const target = ctx.project.lineup[0];
  ctx.patchItem(target.uid, { targetC20: 0 });
  const plans = ctx.recalculate({ silent: true });
  assert.equal(plans, null, '입력 오류가 있으면 계산하지 않는다');
  assert.equal(ctx.state.plansStale, true);
});

test('입력을 채우면 설계안 3종이 계산된다', () => {
  const target = ctx.project.lineup[0];
  ctx.patchItem(target.uid, { targetC20: 54 });
  const plans = ctx.recalculate();
  assert.ok(plans, '계산이 성공해야 한다');
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    assert.ok(plan.commonization >= 0 && plan.commonization <= 100, `공용화율 범위 이상: ${plan.commonization}`);
    assert.equal(plan.designs.length, ctx.project.lineup.length);
    for (const design of plan.designs) {
      assert.ok(design.spec.uid, '설계 결과는 uid를 들고 있어야 한다');
      for (const key of ['c20Margin', 'rcMargin', 'ccaMargin', 'saeMargin']) {
        assert.ok(design[key] === null || Number.isFinite(design[key]), `${key}가 Infinity/NaN이면 안 된다`);
      }
    }
  }
});

test('설계 결과가 입력 제품과 uid로 정확히 짝지어진다', () => {
  const plan = ctx.selectedPlan;
  const inputUids = ctx.project.lineup.map((i) => i.uid);
  const resultUids = plan.designs.map((d) => d.spec.uid);
  assert.deepEqual(resultUids, inputUids, '순서와 대상이 그대로여야 한다');
});

test('모든 화면이 오류 없이 그려진다', () => {
  for (const view of ['workbench', 'requirements', 'matching', 'design', 'costing', 'report', 'database']) {
    ctx.goto(view);
    assert.equal(ctx.state.view, view);
    assert.ok(dom.root.children.length > 0, `${view} 화면이 비어 있다`);
    assert.ok(viewText().length > 200, `${view} 화면 내용이 너무 적다`);
  }
});

test('설계안을 바꾸면 선택안과 스냅샷이 함께 바뀐다', () => {
  ctx.goto('design');
  ctx.selectPlan('existing');
  assert.equal(ctx.project.selectedKind, 'existing');
  assert.equal(ctx.selectedPlan.kind, 'existing');
  assert.equal(ctx.project.resultSnapshot.kind, 'existing');
});

test('저장하면 localStorage에 남고 다시 읽힌다', async () => {
  ctx.saveNow();
  const raw = globalThis.localStorage.getItem('bds-v8-projects');
  assert.ok(raw, '저장된 값이 있어야 한다');
  const saved = JSON.parse(raw);
  assert.equal(saved[0].id, ctx.project.id);
  assert.ok(saved[0].resultSnapshot, '결과 스냅샷이 함께 저장되어야 한다');
  assert.ok(saved[0].resultSnapshot.designs[0].uid, '스냅샷도 uid 기준이어야 한다');
});

test('저장에 실패하면 오류 상태가 표시된다', () => {
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    const error = new Error('quota');
    error.name = 'QuotaExceededError';
    throw error;
  };
  try {
    ctx.patchProject({ name: '용량 초과 시험' });
    ctx.saveNow();
    assert.equal(ctx.state.saveState.state, 'error');
    assert.ok(ctx.state.saveState.message.includes('저장공간'), '사용자에게 이유를 알려야 한다');
  } finally {
    globalThis.localStorage.setItem = original;
  }
});

test('보고서 화면에 엔진·데이터 버전이 찍힌다', () => {
  ctx.goto('report');
  const text = viewText();
  assert.ok(text.includes('v8.0-ported-from-v5.3'), '엔진 버전이 보여야 한다');
  assert.ok(text.includes(db.meta.sourceBuild), '데이터 버전이 보여야 한다');
  assert.ok(text.includes('설계 검토 지원 자료'), '한계 고지가 있어야 한다');
});

/* ============================== 사내 DB 임포트 ============================== */

const importedPlate = (over = {}) => ({
  code: 'SLI99001', name: '임포트 양극', width: 141, height: 121, thickness: '0.90T',
  baseWeight: 41, activeWeight: 101, cost: 451, role: 'positive', usage: 0, ...over,
});
const importedProduct = (over = {}) => ({
  code: 'PCF99001', name: '임포트 제품', group: 'IMPORTED-GRP', type: 'PM',
  c20: 60, rc: 105, encca: 540, saecca: 570, assembly: 13,
  posCode: 'SLI99001', posQty: 7, negCode: 'SLI99002', negQty: 6,
  L: 242, W: 175, H: 190, weight: 15.2, lead: 8.1, observations: 3, ...over,
});

const overlayPayload = {
  mode: 'merge',
  importedAt: '2026-08-14T00:00:00.000Z',
  sources: ['사내DB_2026-08.csv'],
  plates: [importedPlate(), importedPlate({ code: 'SLI99002', name: '임포트 음극', role: 'negative' })],
  products: [importedProduct()],
  salesQty: { PCF99001: 15000 },
};

test('임포트 DB를 적용하면 엔진이 새 DB로 다시 만들어진다', () => {
  const before = ctx.engine.dbStats.references;
  const applied = ctx.setDbOverlay(overlayPayload);
  assert.equal(applied.ok, true, applied.message);
  assert.equal(ctx.engine.dbStats.references, before + 1, '제품 1건이 늘어야 한다');
  assert.equal(ctx.engine.dbStats.plates, db.plates.length + 2, '극판 2건이 늘어야 한다');
  assert.ok(ctx.engine.learningByGroup.has('IMPORTED-GRP'), '새 제품군이 학습 대상에 들어와야 한다');
  assert.equal(ctx.baseDb.products.length, db.products.length, '내장 DB는 그대로여야 한다');
});

test('DB가 바뀌면 계산 결과는 재계산 필요로 되돌아간다', () => {
  // 옛 DB 기준으로 나온 결과를 그대로 두면 바뀐 근거로 결재가 올라갈 수 있다.
  assert.equal(ctx.state.plansStale, true);
  assert.equal(ctx.state.plans, null);
});

test('임포트 DB로도 계산이 끝까지 돌아간다', () => {
  const plans = ctx.recalculate();
  assert.ok(plans, '계산이 되어야 한다');
  assert.equal(ctx.state.plansStale, false);
});

test('임포트 상태가 화면과 사이드바에 표시된다', () => {
  ctx.goto('database');
  assert.ok(viewText().includes('임포트 DB 적용 중'), '적용 중임을 화면에서 알 수 있어야 한다');
  assert.ok(viewText().includes('사내DB_2026-08.csv'), '어떤 파일에서 왔는지 보여야 한다');
  assert.ok(viewText().includes('사내 DB 갱신'), '갱신 카드가 있어야 한다');
});

test('임포트 DB는 브라우저에 저장되어 다음에도 적용된다', () => {
  const raw = globalThis.localStorage.getItem('bds-v8-db-overlay');
  assert.ok(raw, '임포트 DB가 저장되어야 한다');
  const saved = JSON.parse(raw);
  assert.equal(saved.schema, 'bds-overlay-v1');
  assert.equal(saved.products.length, 1);
});

test('임포트 DB 저장에 실패하면 적용하지 않고 이유를 돌려준다', () => {
  const original = globalThis.localStorage.setItem;
  const before = ctx.engine.dbStats.references;
  globalThis.localStorage.setItem = () => {
    const error = new Error('quota');
    error.name = 'QuotaExceededError';
    throw error;
  };
  try {
    const result = ctx.setDbOverlay({ ...overlayPayload, products: [importedProduct({ code: 'PCF99002' })] });
    assert.equal(result.ok, false);
    assert.ok(result.message.includes('저장공간'), '사용자에게 이유를 알려야 한다');
    assert.equal(ctx.engine.dbStats.references, before, '저장 못 했으면 엔진도 바뀌면 안 된다');
  } finally {
    globalThis.localStorage.setItem = original;
  }
});

test('해제하면 내장 DB로 온전히 돌아간다', () => {
  ctx.setDbOverlay(null);
  assert.equal(ctx.engine.dbStats.references, db.products.length);
  assert.equal(ctx.engine.dbStats.plates, db.plates.length);
  assert.equal(ctx.engine.learningByGroup.has('IMPORTED-GRP'), false);
  assert.equal(globalThis.localStorage.getItem('bds-v8-db-overlay'), null);
  assert.ok(ctx.recalculate(), '내장 DB로 돌아와도 계산이 되어야 한다');
});

/* ============================== 예측 보정 ============================== */

test('보정 화면은 과제 없이도 열리고 그려진다', () => {
  ctx.goto('calibration');
  assert.equal(ctx.state.view, 'calibration');
  assert.ok(viewText().includes('예측 보정'));
  assert.ok(viewText().includes('시제품 실측 등록'));
  assert.ok(viewText().includes('어떤 지표도 보정되지 않았습니다'), '초기에는 미적용이어야 한다');
});

test('승인된 보정이 엔진과 화면·보고서에 함께 반영된다', async () => {
  const { addCalibrationSamples, setCalibrationApproval } = await import('../src/core/calibration.js');
  // 예측이 10% 높게 나오는 표본 6건
  const samples = Array.from({ length: 6 }, (_, i) => {
    const observed = 480 + i * 20;
    return { product: `시제품 ${i + 1}`, predicted: observed * 1.1, observed };
  });
  const withSamples = addCalibrationSamples(ctx.calibration, 'encca', samples);

  // 등록만으로는 적용되지 않는다
  assert.equal(ctx.setCalibration(withSamples).ok, true);
  assert.equal(ctx.engine.calibration, null, '승인 전에는 엔진에 들어가면 안 된다');

  // 승인하면 적용된다
  const approved = setCalibrationApproval(ctx.calibration, 'encca', true);
  assert.equal(approved.ok, true);
  assert.equal(ctx.setCalibration(approved.calibration).ok, true);
  assert.ok(ctx.engine.calibration?.encca, '승인하면 엔진에 들어가야 한다');
  assert.ok(ctx.engine.calibration.encca.slope < 1, '예측을 낮추는 방향이어야 한다');

  // 근거가 달라졌으므로 결과는 무효
  assert.equal(ctx.state.plansStale, true);
  assert.equal(ctx.state.plans, null);

  // 사이드바에 표시된다
  assert.ok(viewText().includes('예측 보정 1개 지표 적용 중'));

  // 보고서에도 표기된다
  ctx.openProject(ctx.state.projects[0]);
  ctx.recalculate({ silent: true });
  ctx.goto('report');
  assert.ok(viewText().includes('예측 보정 적용: EN CCA'), '보고서 근거와 한계에 보정 표기가 있어야 한다');
});

test('보정 데이터는 저장되고, 해제하면 원래 예측으로 돌아간다', async () => {
  assert.ok(globalThis.localStorage.getItem('bds-v8-calibration-v1'), '보정이 저장되어야 한다');

  const { setCalibrationApproval } = await import('../src/core/calibration.js');
  const revoked = setCalibrationApproval(ctx.calibration, 'encca', false);
  assert.equal(ctx.setCalibration(revoked.calibration).ok, true);
  assert.equal(ctx.engine.calibration, null);
  assert.equal(ctx.state.plansStale, true, '해제도 근거 변경이므로 결과가 무효여야 한다');
  ctx.recalculate({ silent: true });
  ctx.goto('report');
  assert.ok(viewText().includes('예측 보정 없음'), '보고서가 무보정 상태를 명시해야 한다');
});
