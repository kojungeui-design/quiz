/**
 * test/whatif.test.mjs — 실시간 설계 조절(what-if).
 *
 * 지켜야 할 성질은 네 가지다.
 *   1. 조절값을 주지 않으면 기존 계산과 완전히 같다 (기존 결과가 흔들리면 안 된다).
 *   2. 두께를 올리면 기판납이 그만큼 늘고, 활물질을 올리면 활물질납이 늘고, 매수를 올리면 COS납이 는다.
 *   3. 조절값은 화면 전용이므로 원본 설계 객체를 건드리지 않는다.
 *   4. 0·NaN·음수는 "조절 안 함"으로 본다 (슬라이더가 비어 있는 순간에 계산이 깨지면 안 된다).
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

/** 실측 납중량이 있는 제품 하나를 기준으로 조절 가능한 설계를 만든다. */
const ref = db.products.find((p) => p.lead > 0 && p.assembly >= 9 && p.posCode && p.negCode);
const spec = {
  uid: 'WHATIF',
  id: 'WHATIF',
  name: '조절시험',
  group: ref.group,
  type: engine.technologyOf(ref.group),
  targetC20: 1,
  targetRc: 1,
  targetEnCca: 1,
  targetSaeCca: 1,
  maxPlates: ref.assembly + 4,
  annualVolume: 10000,
  cellCount: 6,
  preferredReferenceCode: ref.code,
};
// 실측 납중량을 감춰야 모델 경로(=조절이 반영되는 경로)를 탄다.
const reference = { ...ref, lead: 0 };
const base = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS);

test('조절값을 주지 않으면 기존 계산과 완전히 같다', () => {
  const empty = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {});
  assert.deepEqual(empty, base);
});

test('0·NaN·음수는 조절하지 않은 것으로 본다', () => {
  for (const bad of [0, NaN, -1, undefined, null]) {
    const design = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
      posThickness: bad,
      negThickness: bad,
      posActiveWeight: bad,
      plateCount: bad,
    });
    assert.deepEqual(design, base, `조절값 ${String(bad)} 이 결과를 바꿨습니다`);
  }
});

test('기판두께를 2배로 올리면 기판납도 2배가 된다', () => {
  const basePosT = Number.parseFloat(String(base.posThickness));
  const baseNegT = Number.parseFloat(String(base.negThickness));
  const thick = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
    posThickness: basePosT * 2,
    negThickness: baseNegT * 2,
    plateCount: base.plateCount, // 매수는 고정해 기판납만 비교
    posActiveWeight: base.posActiveWeight,
  });
  assert.ok(base.leadBreakdown, '기준 설계가 모델 경로여야 합니다');
  assert.ok(Math.abs(thick.leadBreakdown.grid - base.leadBreakdown.grid * 2) < 0.03);
  // 활물질납은 두께와 무관하다
  assert.ok(Math.abs(thick.leadBreakdown.active - base.leadBreakdown.active) < 0.01);
});

test('활물질을 늘리면 활물질납과 총 납중량이 늘어난다', () => {
  const more = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
    posActiveWeight: base.posActiveWeight * 1.2,
    plateCount: base.plateCount,
  });
  assert.ok(more.leadBreakdown.active > base.leadBreakdown.active);
  assert.ok(more.predictedLead > base.predictedLead);
  assert.ok(more.predictedC20 > base.predictedC20, '활물질이 늘면 용량도 늘어야 합니다');
});

test('매수를 늘리면 극판·COS 납이 함께 늘어난다', () => {
  const more = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
    plateCount: base.plateCount + 2,
    posActiveWeight: base.posActiveWeight,
  });
  assert.equal(more.plateCount, base.plateCount + 2);
  assert.ok(more.leadBreakdown.grid > base.leadBreakdown.grid);
  assert.ok(more.leadBreakdown.cos > base.leadBreakdown.cos);
  assert.ok(more.predictedEnCca > base.predictedEnCca, '매수가 늘면 CCA도 올라야 합니다');
});

test('조절해도 원본 설계 객체는 그대로다', () => {
  const snapshot = JSON.stringify(base);
  engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
    posThickness: 1.2,
    negThickness: 1.2,
    posActiveWeight: base.posActiveWeight * 2,
    plateCount: base.plateCount + 4,
  });
  assert.equal(JSON.stringify(base), snapshot);
});

test('조절한 두께는 표시 문자열에 (조정)으로 남는다', () => {
  const design = engine.calculateDesign(spec, 'existing', reference, DEFAULT_ASSUMPTIONS, {
    posThickness: 1.05,
  });
  assert.match(design.posThickness, /1\.05T \(조정\)/);
  assert.equal(design.negThickness, base.negThickness, '음극은 조절하지 않았으므로 그대로여야 합니다');
});
