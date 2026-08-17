/**
 * test/stack.test.mjs — 극판 적층 여유.
 *
 * 이것이 <b>mm 단위 stack-up 계산이 아니라는 점</b>이 이 기능의 전부다.
 * 완성극판 두께·격리판 두께·케이스 내부 치수가 사내 DB에 없어서 절대 치수 계산은 못 한다.
 * (케이스 외형 L로 역산해봤으나 R² 0.80 · P90 오차 24% — 조립 가부를 가를 정확도가 아니다)
 *
 * 대신 답할 수 있는 질문에만 답한다: "이만한 극판이 이 케이스에 들어간 적이 있는가."
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

/** 실적에서 직접 센 셀당 기판두께합 상한. 엔진과 같은 값이 나와야 한다. */
function observedMax(group) {
  let max = 0;
  for (const p of db.products) {
    if (p.group !== group) continue;
    const a = plateByCode.get(p.posCode), b = plateByCode.get(p.negCode);
    if (!a || !b || !(p.posQty > 0) || !(p.negQty > 0)) continue;
    const sum = p.posQty * parseThickness(a.thickness) + p.negQty * parseThickness(b.thickness);
    if (Number.isFinite(sum)) max = Math.max(max, sum);
  }
  return max;
}

test('제품군의 적층 상한은 실적에서 직접 센 값과 같다', () => {
  for (const group of ['D26', 'D31', 'LN3', 'B24', 'EN B']) {
    const check = engine.stackCheck(group, 1, 1, 0.7, 0.7);
    assert.ok(check.budget > 0, `${group} 상한이 없다`);
    assert.equal(check.budget, Number(observedMax(group).toFixed(2)), `${group} 상한이 실적과 다르다`);
  }
});

test('실적으로 만들어진 제품은 모두 자기 제품군 상한 안에 있다', () => {
  // 상한을 실적의 최댓값으로 잡았으므로 당연해야 한다. 어긋나면 집계가 잘못된 것이다.
  let checked = 0;
  for (const p of db.products) {
    const a = plateByCode.get(p.posCode), b = plateByCode.get(p.negCode);
    if (!a || !b || !(p.posQty > 0) || !(p.negQty > 0)) continue;
    const posT = parseThickness(a.thickness), negT = parseThickness(b.thickness);
    if (!(posT > 0) || !(negT > 0)) continue;
    const check = engine.stackCheck(p.group, p.posQty, p.negQty, posT, negT);
    assert.equal(check.overBudget, false, `${p.code}(${p.group}) 가 자기 제품군 상한을 넘었다`);
    checked += 1;
  }
  assert.ok(checked > 600, `검사한 제품이 ${checked}건뿐이다`);
});

test('상한을 넘으면 초과로 표시하고 근거 제품을 함께 준다', () => {
  const budget = engine.stackCheck('D26', 1, 1, 0.7, 0.7);
  // 상한보다 확실히 큰 적층을 만든다.
  const over = engine.stackCheck('D26', 20, 20, 1.0, 1.0);
  assert.equal(over.overBudget, true);
  assert.ok(over.sum > budget.budget);
  assert.ok(over.referenceCode, '어느 제품이 상한인지 알려줘야 한다');
  assert.ok(over.samples > 1, '몇 종을 근거로 삼았는지 알려줘야 한다');
  assert.ok(over.ratio > 1);
});

test('실적이 없는 제품군은 판단하지 않는다', () => {
  const unknown = engine.stackCheck('존재하지-않는-제품군', 10, 10, 1.2, 1.2);
  assert.equal(unknown.budget, null);
  assert.equal(unknown.overBudget, false, '근거가 없는데 초과라고 단정하면 안 된다');
  assert.ok(unknown.sum > 0, '적층 자체는 계산해 준다');
});

const d26ref = db.products.find((p) => p.group === 'D26' && p.posCode && p.negCode);
const d26spec = () => ({
  uid: 'S', id: 'S', name: '적층시험', group: 'D26', type: engine.technologyOf('D26'),
  targetC20: d26ref.c20, targetRc: d26ref.rc, targetEnCca: d26ref.encca, targetSaeCca: d26ref.saecca,
  maxPlates: 16, annualVolume: 10000, cellCount: 6,
});

test('설계 결과에 적층 정보와 경고가 함께 실린다', () => {
  const design = engine.calculateDesign(d26spec(), 'existing', d26ref, DEFAULT_ASSUMPTIONS);
  assert.ok(design.stack, '설계에 적층 정보가 없다');
  assert.ok(design.stack.sum > 0);
  assert.equal(design.stack.overBudget, false);
  assert.equal(design.stackWarning, null);

  // 두께와 매수를 함께 올리면 전례를 벗어나고 경고가 붙는다.
  const thick = engine.calculateDesign(d26spec(), 'existing', d26ref, DEFAULT_ASSUMPTIONS, {
    posThickness: 1.3, negThickness: 1.3, plateCount: 16,
  });
  assert.equal(thick.stack.overBudget, true, '1.3T 로 올렸는데 전례 안이라고 한다');
  assert.match(thick.stackWarning, /적층/);
  assert.match(thick.stackWarning, /전례/);
});

test('적층 경고는 warning 필드를 건드리지 않는다', () => {
  // warning 은 구엔진과 글자까지 맞춰 온 필드다(parity 가 지킨다).
  // 새 조언을 끼워 넣으면 "이식이 정확한가"와 "설계가 괜찮은가"가 뒤섞인다.
  const thick = engine.calculateDesign(d26spec(), 'existing', d26ref, DEFAULT_ASSUMPTIONS, {
    posThickness: 1.3, negThickness: 1.3, plateCount: 16,
  });
  assert.ok(thick.stackWarning, '적층 경고가 있어야 하는 조건이다');
  assert.ok(!(thick.warning || '').includes('적층'), 'warning 에 적층 경고가 섞였다');
});

test('막힌 설계도 같은 모양의 적층 자리를 갖는다', () => {
  const blocked = engine.calculateDesign(
    { uid: 'B', id: 'B', name: '차단', group: '없는제품군', type: 'PA', targetC20: 60, targetRc: 100, targetEnCca: 500, targetSaeCca: 520, maxPlates: 12, annualVolume: 1000, cellCount: 6 },
    'existing', null, DEFAULT_ASSUMPTIONS,
  );
  assert.equal(blocked.compatibility.valid, false);
  assert.equal(blocked.stack.overBudget, false);
  assert.equal(blocked.stackWarning, null);
});
