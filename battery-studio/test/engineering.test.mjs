/**
 * test/engineering.test.mjs — 엔지니어링 안전성.
 *
 * 여기 모인 것들의 공통점: 숫자가 <b>틀리지는 않았는데 과신하기 쉬운</b> 자리다.
 * 근거 밖의 값을 근거 안의 값처럼 내놓으면, 그 숫자를 받은 사람은 확인할 방법이 없다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, parseThickness, DEFAULT_ASSUMPTIONS } from '../src/core/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));
const db = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};
const engine = createEngine(db);
const plateByCode = new Map(db.plates.map((p) => [p.code, p]));

/* ------------- 기술군별 활물질 범위 (이식 시 수정 6) ------------- */

test('PA와 EFB의 활물질 범위를 섞지 않는다', () => {
  // 138×94 는 PA 74~82, EFB 90~90 으로 아예 겹치지 않는다. 섞으면 어느 쪽도
  // 그 기술로 만들어진 적 없는 값을 설계에 허용하게 된다.
  const plate = db.plates.find((p) => p.width === 138 && p.height === 94 && (p.role === 'positive' || p.role === 'both'));
  assert.ok(plate, '138×94 양극이 있어야 이 테스트가 의미 있다');

  const mixed = engine.activeWeightRange(plate);
  const paGroup = db.products.find((p) => engine.technologyOf(p.group) === 'PA').group;
  const efbGroup = db.products.find((p) => engine.technologyOf(p.group) === 'EFB').group;
  const pa = engine.activeWeightRange(plate, paGroup);
  const efb = engine.activeWeightRange(plate, efbGroup);

  // 기술군을 지정하면 언제나 섞은 범위의 부분집합이어야 한다.
  for (const [name, range] of [['PA', pa], ['EFB', efb]]) {
    assert.ok(range[0] >= mixed[0] - 1e-9 && range[1] <= mixed[1] + 1e-9, `${name} 범위가 섞은 범위보다 넓다`);
  }
  assert.notDeepEqual(pa, efb, 'PA와 EFB 범위가 같게 나왔다 — 분리가 동작하지 않는다');
});

test('그 기술군에 근거가 없으면 전체 실적으로 물러선다', () => {
  const plate = db.plates.find((p) => p.role === 'positive' || p.role === 'both');
  const range = engine.activeWeightRange(plate, '실적이-없는-제품군');
  assert.ok(range[0] > 0 && range[1] >= range[0], '근거가 없다고 빈 범위를 주면 안 된다');
});

test('제품군을 넘기지 않으면 종전대로 전체 실적을 본다', () => {
  // 구엔진 호환 경로. parity 가 이 동작에 기대고 있다.
  const plate = db.plates.find((p) => p.role === 'positive' || p.role === 'both');
  const wide = engine.activeWeightRange(plate);
  assert.ok(wide[1] >= wide[0]);
});

/* ------------- 신형 양극 두께 가정 ------------- */

test('0.70T는 극판 마스터에 없는 두께다 — 그래서 가정으로 뺐다', () => {
  const positives = db.plates.filter((p) => p.role === 'positive' || p.role === 'both');
  const thicknesses = positives.map((p) => parseThickness(p.thickness)).filter((t) => t > 0);
  assert.ok(thicknesses.length > 20, '양극이 충분해야 이 테스트가 의미 있다');
  assert.ok(Math.min(...thicknesses) > 0.7, `0.70T 이하 양극이 존재한다 (최소 ${Math.min(...thicknesses)}T)`);
  assert.equal(DEFAULT_ASSUMPTIONS.newPositiveThickness, 0.7, '기본값은 종전 결과를 지키기 위해 0.7 이어야 한다');
});

const ref = db.products.find((p) => plateByCode.has(p.posCode) && plateByCode.has(p.negCode));
const spec = () => ({
  uid: 'E', id: 'E', name: '가정시험', group: ref.group, type: engine.technologyOf(ref.group),
  targetC20: ref.c20, targetRc: ref.rc, targetEnCca: ref.encca, targetSaeCca: ref.saecca,
  maxPlates: ref.assembly + 2, annualVolume: 10000, cellCount: 6,
});

test('신형 양극 두께 가정이 설계에 실제로 반영된다', () => {
  const thin = engine.calculateDesign(spec(), 'new', ref, { ...DEFAULT_ASSUMPTIONS, newPositiveThickness: 0.7 });
  const thick = engine.calculateDesign(spec(), 'new', ref, { ...DEFAULT_ASSUMPTIONS, newPositiveThickness: 0.9 });
  assert.ok(thick.predictedLead > thin.predictedLead, '두껍게 가정했는데 납중량이 그대로다');
  assert.match(thick.posThickness, /0\.90T/);
  assert.match(thin.posThickness, /0\.70T \(Punch\)/, '기본값 표기는 구엔진과 같아야 한다');
});

test('실적에 없는 신형 두께로 계산하면 그 사실을 알린다', () => {
  const design = engine.calculateDesign(spec(), 'new', ref, DEFAULT_ASSUMPTIONS);
  assert.ok(design.assumptionWarning, '0.70T 는 실적에 없으므로 알려야 한다');
  assert.match(design.assumptionWarning, /0\.70T/);

  // 실적에 있는 두께로 맞추면 경고가 사라진다.
  const real = engine.calculateDesign(spec(), 'new', ref, { ...DEFAULT_ASSUMPTIONS, newPositiveThickness: 0.9 });
  assert.equal(real.assumptionWarning, null, '실적에 있는 두께인데 경고가 남았다');
});

test('가정 경고는 warning 필드를 건드리지 않는다', () => {
  const design = engine.calculateDesign(spec(), 'new', ref, DEFAULT_ASSUMPTIONS);
  assert.ok(!(design.warning || '').includes('극판 마스터에 없는'), 'warning 에 가정 경고가 섞였다');
});

test('3안(기존 극판)은 신형 두께 가정과 무관하다', () => {
  const a = engine.calculateDesign(spec(), 'existing', ref, DEFAULT_ASSUMPTIONS);
  const b = engine.calculateDesign(spec(), 'existing', ref, { ...DEFAULT_ASSUMPTIONS, newPositiveThickness: 1.1 });
  assert.equal(a.predictedLead, b.predictedLead);
  assert.equal(a.unitCost, b.unitCost);
  assert.equal(a.assumptionWarning, null);
});

/* ------------- CSV 수식 주입 ------------- */

test('엑셀 수식으로 시작하는 값은 수식으로 실행되지 않게 감싼다', async () => {
  const { toCsv } = await import('../src/core/export.js');
  const csv = toCsv([['제품', '비고'], ['=1+1', '+SUM(A1:A9)'], ['정상', -5]]);
  assert.ok(csv.includes(`"'=1+1"`), '= 로 시작하는 값이 그대로 나갔다');
  assert.ok(csv.includes(`"'+SUM(A1:A9)"`), '+ 로 시작하는 값이 그대로 나갔다');
  assert.ok(csv.includes('"-5"'), '숫자 음수는 그대로 남아야 한다');
  assert.ok(!csv.includes(`"'-5"`), '숫자에 따옴표를 붙이면 안 된다');
});
