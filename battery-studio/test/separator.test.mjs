/**
 * test/separator.test.mjs — 격리판 봉합 극성.
 *
 * 봉합은 설계자가 고르는 값이 아니라 극판 조합이 정하는 파생값이다.
 * 사내 실적 9,319건 분석: 극판 조합 99.7% · 제품군 95.0% 로 결정된다.
 * 이 테스트는 "실적에서 끌어온다"는 원칙과, 근거가 없을 때 추측하지 않는다는 규칙을 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, DEFAULT_ASSUMPTIONS } from '../src/core/engine.js';

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

test('제품 데이터 740건 전부에 봉합 값이 있다', () => {
  const missing = db.products.filter((p) => p.separator !== 'negative' && p.separator !== 'positive');
  assert.equal(missing.length, 0, `봉합 미지정 ${missing.length}건: ${missing.slice(0, 3).map((p) => p.code)}`);
});

test('극판 조합 실적을 제품군보다 먼저 본다', () => {
  const product = db.products.find((p) => p.posCode && p.negCode);
  const result = engine.separatorFor(product.posCode, product.negCode, product.group);
  assert.equal(result.basis, '극판 조합 실적');
  assert.ok(result.total > 0);
});

test('극판 조합 실적이 없으면 제품군 실적으로 물러선다', () => {
  const group = db.products[0].group;
  const result = engine.separatorFor('없는코드', '없는코드', group);
  assert.equal(result.basis, '제품군 실적');
  assert.ok(result.value === 'negative' || result.value === 'positive');
});

test('근거가 전혀 없으면 추측하지 않고 판단 불가로 둔다', () => {
  const result = engine.separatorFor('없는코드', '없는코드', '없는제품군');
  assert.equal(result.value, null);
  assert.equal(result.label, '판단 불가');
  assert.equal(result.basis, '실적 없음');
});

test('실적에 예외가 섞이면 conflict 로 알린다', () => {
  // 모든 조합을 훑어 다수결이 만장일치가 아닌 것이 있으면 conflict 여야 한다.
  let checkedConflict = false;
  let checkedClean = false;
  for (const p of db.products) {
    const r = engine.separatorFor(p.posCode, p.negCode, p.group);
    if (r.total === 0) continue;
    assert.equal(r.conflict, r.agree < r.total, `${p.posCode}|${p.negCode} conflict 표기가 실제와 다르다`);
    if (r.conflict) checkedConflict = true;
    else checkedClean = true;
  }
  assert.ok(checkedClean, '만장일치 조합이 있어야 한다');
  // conflict 조합은 있을 수도 없을 수도 있다 — 표기 일관성만 위에서 확인했다.
  void checkedConflict;
});

test('실적 제품을 되돌려 넣으면 등록된 봉합이 그대로 나온다', () => {
  // 극판 조합이 단일한 제품만 골라 확인한다(예외가 섞인 조합은 다수결이 정답이 아닐 수 있다).
  let checked = 0;
  for (const p of db.products) {
    const r = engine.separatorFor(p.posCode, p.negCode, p.group);
    if (r.conflict || !r.value) continue;
    assert.equal(r.value, p.separator, `${p.code} 봉합 불일치`);
    checked++;
  }
  assert.ok(checked > 600, `충분히 검증되어야 한다 (${checked}건)`);
});

test('설계 결과에 봉합이 함께 나온다', () => {
  const group = db.products[0].group;
  const learn = engine.learningByGroup.get(group);
  const spec = {
    uid: 'u1', id: 'x', name: 'x', group, type: engine.technologyOf(group),
    targetC20: learn.performance.c20.typical, targetRc: learn.performance.rc.typical,
    targetEnCca: learn.performance.enCca.typical, targetSaeCca: learn.performance.saeCca.typical,
    maxPlates: learn.assembly.max, annualVolume: 10000, cellCount: 6,
  };
  for (const plan of engine.buildPlans([spec], 'balanced', DEFAULT_ASSUMPTIONS)) {
    const d = plan.designs[0];
    assert.ok(d.separator, `${plan.kind} 에 봉합 정보가 없다`);
    assert.ok(['(−)봉합', '(+)봉합', '판단 불가'].includes(d.separator.label));
  }
});

test('신형 극판 설계도 원본 극판 조합의 봉합을 따른다', () => {
  // 신형은 같은 크기 극판을 다시 만드는 것이므로 봉합 방식이 바뀔 이유가 없다.
  const group = db.products[0].group;
  const learn = engine.learningByGroup.get(group);
  const spec = {
    uid: 'u1', id: 'x', name: 'x', group, type: engine.technologyOf(group),
    targetC20: learn.performance.c20.typical, targetRc: learn.performance.rc.typical,
    targetEnCca: learn.performance.enCca.typical, targetSaeCca: learn.performance.saeCca.typical,
    maxPlates: learn.assembly.max, annualVolume: 10000, cellCount: 6,
  };
  const plans = engine.buildPlans([spec], 'balanced', DEFAULT_ASSUMPTIONS);
  const labels = new Set(plans.map((p) => p.designs[0].separator.label));
  assert.equal(labels.size, 1, `3개안의 봉합이 서로 달라졌다: ${[...labels]}`);
});

test('차단된 설계는 봉합도 판단 불가로 둔다', () => {
  const blocked = engine.calculateDesign(
    { uid: 'x', id: 'x', name: 'x', group: db.products[0].group, type: 'AGM', targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1, maxPlates: 10, annualVolume: 1000, cellCount: 6 },
    'existing', null, DEFAULT_ASSUMPTIONS,
  );
  assert.equal(blocked.separator.value, null);
});
