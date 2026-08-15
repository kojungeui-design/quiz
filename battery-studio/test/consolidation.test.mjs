/**
 * test/consolidation.test.mjs — 극판군 통합 곡선.
 *
 * 이 곡선이 답하는 것은 "몇 개가 최적인가"가 아니라 "1종 더 만들면 연간 얼마를 버는가"다.
 * 금형비가 0이면 원가만으로는 극판이 많을수록 항상 유리해 최적점이 없기 때문이다.
 *
 * 지켜야 할 성질
 *   1. 첫 점은 현재 안이다 — 화면에서 보고 있는 것과 출발점이 달라선 안 된다.
 *   2. 극판군이 늘수록 연간 총원가는 줄어든다 (안 줄면 곡선을 늘리지 않는다).
 *   3. 극판군이 늘어서 목표 충족이 줄어드는 일은 없다 (선택지가 늘 뿐이므로).
 *   4. 제품군을 넘는 강제 공용은 하지 않는다.
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

/** 극판군 선택지가 여럿인 제품군에서, 사양이 서로 다른 제품 4종을 만든다. */
function lineupOf(group, volumes = [60000, 40000, 20000, 10000]) {
  const refs = db.products.filter((p) => p.group === group).sort((a, b) => a.c20 - b.c20);
  const picks = [refs[0], refs[Math.floor(refs.length / 3)], refs[Math.floor((refs.length * 2) / 3)], refs[refs.length - 1]];
  return picks.map((r, i) => ({
    uid: `P${i}`,
    id: `P${i}`,
    name: `제품${i + 1}`,
    group,
    type: engine.technologyOf(group),
    targetC20: r.c20,
    targetRc: r.rc,
    targetEnCca: r.encca,
    targetSaeCca: r.saecca,
    maxPlates: r.assembly + 2,
    annualVolume: volumes[i],
    cellCount: 6,
  }));
}

const GROUPS = ['D26', 'D23', 'D31', 'LN3', 'B24'];

test('첫 점은 지금 화면에 보이는 안과 같은 극판군 수다', () => {
  for (const group of GROUPS) {
    const specs = lineupOf(group);
    for (const kind of ['existing', 'new', 'hybrid']) {
      const curve = engine.consolidationCurve(specs, kind, 'balanced', DEFAULT_ASSUMPTIONS);
      if (!curve.length) continue;
      const plan = engine.buildPlan(specs, kind, 'balanced', DEFAULT_ASSUMPTIONS);
      assert.equal(curve[0].familyCount, plan.commonFamilies, `${group}/${kind} 출발점이 현재 안과 다르다`);
    }
  }
});

test('극판군이 늘수록 연간 총원가는 줄고, 절감액은 양수다', () => {
  for (const group of GROUPS) {
    const specs = lineupOf(group);
    for (const kind of ['existing', 'new', 'hybrid']) {
      const curve = engine.consolidationCurve(specs, kind, 'balanced', DEFAULT_ASSUMPTIONS);
      for (let i = 1; i < curve.length; i += 1) {
        assert.ok(curve[i].familyCount > curve[i - 1].familyCount, `${group}/${kind} 극판군 수가 안 늘었다`);
        assert.ok(curve[i].annualCost < curve[i - 1].annualCost, `${group}/${kind} 원가가 안 줄었는데 점을 늘렸다`);
        assert.ok(curve[i].marginalSaving > 0, `${group}/${kind} 절감액이 0 이하다`);
        assert.equal(
          curve[i].marginalSaving,
          curve[i - 1].annualCost - curve[i].annualCost,
          '절감액이 연간 총원가 차이와 맞지 않는다',
        );
      }
    }
  }
});

test('극판군을 늘렸다고 목표 충족이 줄어들지는 않는다', () => {
  for (const group of GROUPS) {
    const specs = lineupOf(group);
    for (const kind of ['existing', 'new', 'hybrid']) {
      const curve = engine.consolidationCurve(specs, kind, 'balanced', DEFAULT_ASSUMPTIONS);
      for (let i = 1; i < curve.length; i += 1) {
        assert.ok(
          curve[i].passCount >= curve[i - 1].passCount,
          `${group}/${kind} 선택지가 늘었는데 목표 충족이 줄었다`,
        );
      }
    }
  }
});

test('제품군을 넘는 강제 공용은 하지 않는다', () => {
  const specs = lineupOf('D26');
  const curve = engine.consolidationCurve(specs, 'existing', 'balanced', DEFAULT_ASSUMPTIONS);
  assert.ok(curve.length, 'D26 은 선택지가 있어야 한다');
  for (const point of curve) {
    for (const design of point.plan.designs) {
      assert.equal(design.reference.group, design.spec.group, '다른 제품군 극판을 끌어다 썼다');
    }
  }
});

test('제품이 하나뿐이면 검토할 것이 없다', () => {
  const [one] = lineupOf('D26');
  assert.deepEqual(engine.consolidationCurve([one], 'existing', 'balanced', DEFAULT_ASSUMPTIONS), []);
});

test('곡선을 계산해도 원래 라인업 입력은 그대로다', () => {
  const specs = lineupOf('D26');
  const snapshot = JSON.stringify(specs);
  engine.consolidationCurve(specs, 'existing', 'balanced', DEFAULT_ASSUMPTIONS);
  assert.equal(JSON.stringify(specs), snapshot);
});

test('선택지가 있는 제품군에서는 실제로 곡선이 두 점 이상 나온다', () => {
  // 곡선이 늘 1점이면 이 기능은 화면만 차지한다. 최소 한 제품군에서는 갈래가 있어야 한다.
  const multi = GROUPS.filter((group) => {
    const specs = lineupOf(group);
    return ['existing', 'new', 'hybrid'].some(
      (kind) => engine.consolidationCurve(specs, kind, 'balanced', DEFAULT_ASSUMPTIONS).length >= 2,
    );
  });
  assert.ok(multi.length >= 3, `갈래가 있는 제품군이 ${multi.length}개뿐이다`);
});
