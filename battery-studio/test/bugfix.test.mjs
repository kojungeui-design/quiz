/**
 * test/bugfix.test.mjs — 구엔진 버그가 실제로 있었고, 신엔진에서 고쳐졌음을 함께 증명한다.
 *
 * 각 테스트는 "구엔진은 이렇게 틀렸다"를 먼저 확인한 뒤 "신엔진은 이렇다"를 검증한다.
 * 구엔진 동작이 바뀌면(=추출이 잘못되면) 테스트가 깨지므로, 대조가 헛돌지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as legacy from './fixtures/legacy-engine.generated.mjs';
import { createEngine, weightedMedian, marginPct, DEFAULT_ASSUMPTIONS } from '../src/core/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));
const engine = createEngine({
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
  groupOrder: src('group-order.json'),
  meta: src('meta.json'),
});
const assumptions = legacy.so;

const baseSpec = {
  id: 'LN1',
  group: 'LN1',
  type: 'PA',
  targetC20: 54,
  targetRc: 90,
  targetEnCca: 530,
  targetSaeCca: 550,
  maxPlates: 11,
  annualVolume: 60000,
};

test('수정1 · 목표값을 비우면(0) 구엔진은 Infinity를 출력했고, 신엔진은 null을 낸다', () => {
  const spec = { ...baseSpec, targetC20: 0 };

  const old = legacy.An([spec], 'balanced', assumptions)[1].designs[0];
  assert.equal(Number.isFinite(old.c20Margin), false, '구엔진은 유한한 값이 아니어야 한다(버그 재현)');

  const fixed = engine.buildPlans([spec], 'balanced', assumptions)[1].designs[0];
  assert.equal(fixed.c20Margin, null, '신엔진은 계산 불가를 null로 표시한다');
  assert.ok(Number.isFinite(fixed.rcMargin), '나머지 목표는 정상 계산되어야 한다');
  assert.ok(Number.isFinite(fixed.predictedC20), '예측값 자체는 여전히 나와야 한다');
});

test('수정1 · 목표가 0인 제품은 "목표 충족"으로 집계되지 않는다', () => {
  const spec = { ...baseSpec, targetC20: 0 };
  const plan = engine.buildPlans([spec], 'balanced', assumptions)[1];
  assert.equal(engine.planSummary(plan).passCount, 0, '입력이 불완전하면 통과로 세지 않는다');
});

test('수정2 · 호환 조합이 전무하면 구엔진은 공용화율 100%를 넘겼고, 신엔진은 0%다', () => {
  // 기술 분류를 어긋나게 해 모든 제품을 차단 상태로 만든다 → 유효 극판군 0개
  const blocked = ['LN1', 'LN2', 'LN3'].map((group) => ({ ...baseSpec, id: group, group, type: 'AGM' }));

  const old = legacy.An(blocked, 'balanced', assumptions)[1];
  assert.ok(old.commonFamilies === 0, '전제: 유효 극판군이 0개인 상황');
  assert.ok(old.commonization > 100, `구엔진은 100%를 넘겼다(실제 ${old.commonization}%)`);

  const fixed = engine.buildPlans(blocked, 'balanced', assumptions)[1];
  assert.equal(fixed.commonFamilies, 0);
  assert.equal(fixed.commonization, 0, '공용할 극판군이 없으면 0%');
});

test('수정2 · 정상적인 경우의 공용화율은 구엔진과 그대로 같다', () => {
  const specs = ['LN1', 'LN2', 'LN3'].map((group, i) => ({ ...baseSpec, id: group, group, annualVolume: 10000 * (i + 1) }));
  const mine = engine.buildPlans(specs, 'balanced', assumptions);
  const theirs = legacy.An(specs, 'balanced', assumptions);
  mine.forEach((plan, i) => {
    assert.ok(plan.commonFamilies > 0, '전제: 유효 극판군이 있는 상황');
    assert.equal(plan.commonization, theirs[i].commonization, plan.kind);
  });
});

test('수정3 · 셀 수를 지정하면 극판 재료비가 그만큼만 반영된다', () => {
  const ref = engine.candidatesFor(baseSpec)[0];
  const materialCostOf = (design) => design.unitCost / (1 + assumptions.contingencyRate / 100) - assumptions.conversionCost;

  const cells6 = engine.calculateDesign({ ...baseSpec, cellCount: 6 }, 'existing', ref, assumptions);
  const cells3 = engine.calculateDesign({ ...baseSpec, cellCount: 3 }, 'existing', ref, assumptions);
  const cells12 = engine.calculateDesign({ ...baseSpec, cellCount: 12 }, 'existing', ref, assumptions);

  assert.equal(cells6.plateCount, cells3.plateCount, '셀 수는 극판 설계 자체를 바꾸지 않는다');
  assert.equal(cells6.predictedC20, cells3.predictedC20, '셀 수는 셀당 성능 예측을 바꾸지 않는다');

  const ratio = materialCostOf(cells6) / materialCostOf(cells3);
  assert.ok(Math.abs(ratio - 2) < 0.001, `6셀 재료비는 3셀의 2배여야 한다 (실제 ${ratio.toFixed(4)})`);
  assert.ok(materialCostOf(cells12) > materialCostOf(cells6), '12셀이 더 비싸야 한다');
});

test('수정3 · 셀 수를 지정하지 않으면 구엔진과 동일하게 6셀로 계산한다', () => {
  const ref = engine.candidatesFor(baseSpec)[0];
  const implicit = engine.calculateDesign(baseSpec, 'existing', ref, assumptions);
  const explicit = engine.calculateDesign({ ...baseSpec, cellCount: 6 }, 'existing', ref, assumptions);
  const old = legacy.Cm(baseSpec, 'existing', ref, assumptions);
  assert.equal(implicit.unitCost, explicit.unitCost);
  assert.equal(implicit.unitCost, old.unitCost, '기본값은 구엔진과 같아야 한다');
});

test('가중 중앙값은 판매수량이 많은 쪽으로 대표값을 옮긴다', () => {
  // 값 10이 1건(가중 1), 값 100이 1건(가중 99) → 대표값은 100 쪽
  assert.equal(weightedMedian([{ value: 10, weight: 1 }, { value: 100, weight: 99 }]), 100);
  assert.equal(weightedMedian([{ value: 10, weight: 99 }, { value: 100, weight: 1 }]), 10);
  assert.equal(weightedMedian([]), 0, '표본이 없으면 0');
  assert.equal(weightedMedian([{ value: 0, weight: 5 }]), 0, '0 이하 값은 표본에서 제외');
  assert.equal(weightedMedian([{ value: 50, weight: 0 }]), 0, '가중치 0도 제외');
});

test('마진 계산은 목표가 없으면 null, 있으면 백분율', () => {
  assert.equal(marginPct(110, 100), 10);
  assert.equal(marginPct(90, 100), -10);
  assert.equal(marginPct(100, 0), null);
  assert.equal(marginPct(100, -5), null);
});

test('기본 원가 가정은 금형비만 0으로 바로잡고 나머지는 구엔진 값을 유지한다', () => {
  // 사내에는 극판 금형이 확보되어 있어 신규 극판에 금형투자가 발생하지 않는다.
  // 구엔진의 2,600만/1,200만원은 실제로 나가지 않는 돈인데도 신형안(1·2안) 대당 원가에
  // 분담금으로 실려 원가 비교와 안 순위를 왜곡했다. 투자가 실제로 생기는 과제라면
  // 요구사양 화면에서 넣을 수 있으므로, 기본값만 0으로 둔다.
  assert.equal(DEFAULT_ASSUMPTIONS.newToolingCost, 0);
  assert.equal(DEFAULT_ASSUMPTIONS.hybridToolingCost, 0);
  assert.equal(DEFAULT_ASSUMPTIONS.conversionCost, legacy.so.conversionCost);
  assert.equal(DEFAULT_ASSUMPTIONS.contingencyRate, legacy.so.contingencyRate);
  assert.deepEqual(Object.keys(DEFAULT_ASSUMPTIONS).sort(), Object.keys(legacy.so).sort());
});

test('수정5 · 신형 양극 단가 분할은 55/45 고정이 아니라 극판별 실측 비중을 쓴다', () => {
  // 극판 마스터 120종 회귀(단가 ≈ 4.73×기판g + 2.39×활물질g, R² 0.973) 기준
  // 기판 비중은 평균 40.7%(31~50%)로, 구엔진의 55% 고정 가정은 신형안 원가를 싸게 만들었다.
  const spec = { ...baseSpec, maxPlates: 12 };
  const ref = engine.candidatesFor(spec)[0];

  const mine = engine.calculateDesign(spec, 'new', ref, assumptions);
  const old = legacy.Cm(spec, 'new', ref, assumptions);
  // 구엔진(55% 고정)이 신엔진(실측 비중 ~41%)보다 기판 절감을 크게 쳐서 원가가 낮았다.
  assert.ok(mine.unitCost > old.unitCost, `신형안 원가가 올라야 한다 (구 ${old.unitCost} → 신 ${mine.unitCost})`);
  // 성능·매수·공용화는 원가와 무관하므로 그대로여야 한다.
  assert.equal(mine.plateCount, old.plateCount);
  assert.equal(mine.predictedEnCca, old.predictedEnCca);

  // 기존 극판 경로(3안)는 분할이 개입하지 않으므로 구엔진과 완전히 같다.
  const mineExisting = engine.calculateDesign(spec, 'existing', ref, assumptions);
  const oldExisting = legacy.Cm(spec, 'existing', ref, assumptions);
  assert.equal(mineExisting.unitCost, oldExisting.unitCost);
});

test('저장된 과제의 구버전 기본 금형비는 0으로 내리고, 직접 넣은 금액은 그대로 둔다', async () => {
  const { normalizeProject } = await import('../src/core/project.js');
  const untouched = normalizeProject(engine, {
    assumptions: { conversionCost: 14300, newToolingCost: 26000000, hybridToolingCost: 12000000, contingencyRate: 3 },
  });
  assert.equal(untouched.assumptions.newToolingCost, 0, '손대지 않은 구버전 기본값은 0이어야 한다');
  assert.equal(untouched.assumptions.hybridToolingCost, 0);
  assert.equal(untouched.assumptions.conversionCost, 14300, '가공비는 건드리면 안 된다');

  const deliberate = normalizeProject(engine, {
    assumptions: { newToolingCost: 5000000, hybridToolingCost: 3000000 },
  });
  assert.equal(deliberate.assumptions.newToolingCost, 5000000, '직접 넣은 투자액은 보존해야 한다');
  assert.equal(deliberate.assumptions.hybridToolingCost, 3000000);
});
