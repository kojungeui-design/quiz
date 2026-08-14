/**
 * test/lead.test.mjs — 납중량 계산.
 *
 * 모델: 납중량 = 기판납 + 활물질납(환산 1.04×1.195/1.175) + COS납(잔차 회귀).
 * 계수는 실측 납중량이 있는 제품 735건으로 적합했다. 이 테스트는 그 정확도가
 * 코드 수정으로 퇴행하지 않는지(MAPE 상한)와 경계 동작을 고정한다.
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

/** 실측 제품을 "기준품 고정 없이" 스펙으로 되돌려 모델 경로를 태운다. */
function modelLeadOf(product) {
  const spec = {
    uid: product.code,
    id: product.code,
    name: product.code,
    group: product.group,
    type: engine.technologyOf(product.group),
    targetC20: 1,
    targetRc: 1,
    targetEnCca: 1,
    targetSaeCca: 1,
    maxPlates: product.assembly,
    annualVolume: 10000,
    cellCount: 6,
  };
  const ref = { ...product, lead: 0 }; // 실측 납중량을 감춰 모델 경로를 강제
  const design = engine.calculateDesign({ ...spec, preferredReferenceCode: product.code }, 'existing', ref, DEFAULT_ASSUMPTIONS);
  return design;
}

test('납중량 모델은 실측 735건 대비 평균오차 4.5% 아래를 유지한다', () => {
  const samples = db.products.filter(
    (p) => p.lead > 0 && p.posQty > 0 && p.negQty > 0 && engine.plateByCode.has(p.posCode) && engine.plateByCode.has(p.negCode),
  );
  assert.ok(samples.length > 700, `표본이 충분해야 한다 (${samples.length})`);

  const errors = [];
  for (const product of samples) {
    const design = modelLeadOf(product);
    if (!(design.predictedLead > 0)) continue;
    errors.push(Math.abs(design.predictedLead - product.lead) / product.lead);
  }
  assert.ok(errors.length > 700, `계산 성공이 충분해야 한다 (${errors.length})`);
  const mape = (errors.reduce((a, b) => a + b, 0) / errors.length) * 100;
  const p90 = [...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.9)] * 100;
  // 적합 시점 기준 MAPE 3.9% · P90 8.3%. 퇴행 방지용 여유를 두고 상한을 건다.
  assert.ok(mape < 4.5, `MAPE ${mape.toFixed(2)}% — 납중량 모델이 퇴행했다`);
  assert.ok(p90 < 10, `P90 ${p90.toFixed(1)}% — 꼬리 오차가 커졌다`);
});

test('기준품 고정 설계는 등록 실측 납중량을 그대로 쓴다', () => {
  const product = db.products.find((p) => p.lead > 0 && p.assembly > 0 && engine.plateByCode.has(p.posCode) && engine.plateByCode.has(p.negCode));
  const spec = {
    uid: 'x', id: 'x', name: 'x', group: product.group, type: engine.technologyOf(product.group),
    targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1,
    maxPlates: product.assembly, annualVolume: 10000, cellCount: 6,
    preferredReferenceCode: product.code,
  };
  const design = engine.calculateDesign(spec, 'existing', product, DEFAULT_ASSUMPTIONS);
  assert.equal(design.predictedLead, product.lead, '실측이 있으면 실측을 써야 한다');
  assert.equal(design.leadSource, '실측');
  assert.equal(design.leadBreakdown, null, '실측에는 분해 내역이 없다');
});

test('모델 경로는 출처와 분해 내역(기판+활물질+COS=합계)을 함께 준다', () => {
  const product = db.products.find((p) => p.lead > 0 && p.posQty > 0 && p.negQty > 0 && engine.plateByCode.has(p.posCode) && engine.plateByCode.has(p.negCode));
  const design = modelLeadOf(product);
  assert.equal(design.leadSource, '모델');
  const b = design.leadBreakdown;
  assert.ok(b && b.grid > 0 && b.active > 0 && b.cos >= 0);
  assert.ok(Math.abs(b.grid + b.active + b.cos - design.predictedLead) < 0.02, '분해 합계가 총량과 맞아야 한다');
});

test('납중량은 셀 수에 비례해 커진다 (6셀 하드코딩이 아니다)', () => {
  const product = db.products.find((p) => p.lead > 0 && p.posQty > 0 && p.negQty > 0 && engine.plateByCode.has(p.posCode) && engine.plateByCode.has(p.negCode));
  const mkSpec = (cells) => ({
    uid: 'x', id: 'x', name: 'x', group: product.group, type: engine.technologyOf(product.group),
    targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1,
    maxPlates: product.assembly, annualVolume: 10000, cellCount: cells,
    preferredReferenceCode: product.code,
  });
  const ref = { ...product, lead: 0 };
  const six = engine.calculateDesign(mkSpec(6), 'existing', ref, DEFAULT_ASSUMPTIONS);
  const three = engine.calculateDesign(mkSpec(3), 'existing', ref, DEFAULT_ASSUMPTIONS);
  const twelve = engine.calculateDesign(mkSpec(12), 'existing', ref, DEFAULT_ASSUMPTIONS);
  assert.ok(three.predictedLead < six.predictedLead, '6V(3셀)는 12V(6셀)보다 가벼워야 한다');
  assert.ok(twelve.predictedLead > six.predictedLead * 1.9, '24V(12셀)는 대략 2배여야 한다');
});

test('차단 설계는 납중량 0과 차단 출처를 돌려준다', () => {
  const blocked = engine.calculateDesign(
    { uid: 'x', id: 'x', name: 'x', group: db.products[0].group, type: 'AGM', targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1, maxPlates: 10, annualVolume: 1000, cellCount: 6 },
    'existing',
    null,
    DEFAULT_ASSUMPTIONS,
  );
  assert.equal(blocked.predictedLead, 0);
  assert.equal(blocked.leadSource, '차단');
});

test('신형 양극 설계는 얇아진 기판만큼 납이 줄어든 값으로 계산된다', () => {
  // 0.90T → 0.70T 환산이 납중량에도 반영되는지: 신형(new)의 기판납은 기존(existing)보다 작아야 한다.
  const product = db.products.find(
    (p) => p.lead > 0 && p.posQty > 0 && p.negQty > 0 && engine.plateByCode.has(p.posCode) && engine.plateByCode.has(p.negCode) &&
      parseFloat(String(engine.plateByCode.get(p.posCode).thickness)) > 0.75,
  );
  const spec = {
    uid: 'x', id: 'x', name: 'x', group: product.group, type: engine.technologyOf(product.group),
    targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1,
    maxPlates: product.assembly, annualVolume: 10000, cellCount: 6,
  };
  const ref = { ...product, lead: 0 };
  const existing = engine.calculateDesign(spec, 'existing', ref, DEFAULT_ASSUMPTIONS);
  const brandNew = engine.calculateDesign(spec, 'new', ref, DEFAULT_ASSUMPTIONS);
  if (existing.plateCount === brandNew.plateCount && existing.posActiveWeight === brandNew.posActiveWeight) {
    assert.ok(brandNew.leadBreakdown.grid < existing.leadBreakdown.grid, '신형 기판납이 더 가벼워야 한다');
  } else {
    // 활물질 재배분으로 매수·활물질이 달라졌으면 기판납 '매당' 비교로 확인한다.
    const perPlateNew = brandNew.leadBreakdown.grid / brandNew.plateCount;
    const perPlateOld = existing.leadBreakdown.grid / existing.plateCount;
    assert.ok(perPlateNew < perPlateOld, '신형 기판납(매당)이 더 가벼워야 한다');
  }
});
