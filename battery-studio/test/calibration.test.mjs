/**
 * test/calibration.test.mjs — 예측 보정.
 *
 * 보정은 잘못 걸리면 모든 예측을 조용히 망가뜨린다. 그래서 "보정이 잘 된다"보다
 * "쓰면 안 되는 보정을 못 쓰게 막는다"를 더 촘촘히 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_CALIBRATION_SAMPLES,
  emptyCalibration,
  fitCalibration,
  calibrationEligibility,
  activeCalibrationModels,
  calibrationSummary,
  addCalibrationSamples,
  removeCalibrationSample,
  setCalibrationApproval,
  parseCalibrationCsv,
  calibrationTemplateRows,
} from '../src/core/calibration.js';
import { createEngine } from '../src/core/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));
const db = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};

/** 예측이 실제보다 늘 10% 높게 나오는 상황. 이상적인 보정 대상이다. */
const biasedSamples = (n = 6) =>
  Array.from({ length: n }, (_, i) => {
    const observed = 480 + i * 20;
    return { predicted: observed * 1.1, observed };
  });

/* ============================== 적합 ============================== */

test('표본이 모자라면 적합하지 않는다', () => {
  assert.equal(fitCalibration(biasedSamples(MIN_CALIBRATION_SAMPLES - 1)), null);
  assert.ok(fitCalibration(biasedSamples(MIN_CALIBRATION_SAMPLES)));
});

test('일정한 편향은 기울기로 정확히 잡힌다', () => {
  const fit = fitCalibration(biasedSamples(8));
  assert.equal(fit.n, 8);
  // observed = predicted / 1.1 이므로 기울기는 1/1.1
  assert.ok(Math.abs(fit.slope - 1 / 1.1) < 1e-9, `slope=${fit.slope}`);
  assert.ok(Math.abs(fit.intercept) < 1e-6, `intercept=${fit.intercept}`);
  assert.ok(fit.r2 > 0.999);
  assert.ok(fit.rmse < 1e-6, '완전한 선형이면 잔차가 0에 가까워야 한다');
  assert.ok(Math.abs(fit.meanBias - 10) < 1e-6, '예측이 10% 높다고 읽혀야 한다');
});

test('무보정 대비 얼마나 나아지는지 함께 계산한다', () => {
  const fit = fitCalibration(biasedSamples(8));
  assert.ok(fit.baselineMape > 9 && fit.baselineMape < 11, `무보정 오차 ${fit.baselineMape}`);
  assert.ok(fit.mape < 0.001, '보정하면 오차가 거의 사라져야 한다');
  assert.ok(fit.rmse < fit.baselineRmse);
});

test('숫자가 아니거나 0 이하인 표본은 적합에서 빠진다', () => {
  const samples = [...biasedSamples(6), { predicted: 0, observed: 500 }, { predicted: 500, observed: NaN }];
  const fit = fitCalibration(samples);
  assert.equal(fit.n, 6);
  assert.equal(fit.excluded, 2);
});

test('예측값이 전부 같으면 절편만 옮긴다', () => {
  const samples = Array.from({ length: 6 }, (_, i) => ({ predicted: 500, observed: 470 + i }));
  const fit = fitCalibration(samples);
  assert.equal(fit.slope, 1, '기울기를 정할 수 없으면 1로 두어야 한다');
  assert.ok(fit.intercept < 0, '평균적으로 예측이 높았으므로 절편은 음수여야 한다');
});

test('표본 예측값의 범위를 함께 기록한다', () => {
  const fit = fitCalibration(biasedSamples(6));
  assert.equal(fit.range[0], 480 * 1.1);
  assert.equal(fit.range[1], 580 * 1.1);
});

/* ============================== 승인 조건 ============================== */

test('기울기가 상식 범위를 벗어나면 승인할 수 없다', () => {
  // 예측 500 근처에서 실측이 100~900으로 튀는, 명백히 섞인 데이터
  const samples = [
    { predicted: 500, observed: 120 },
    { predicted: 505, observed: 900 },
    { predicted: 510, observed: 150 },
    { predicted: 515, observed: 880 },
    { predicted: 520, observed: 200 },
    { predicted: 525, observed: 950 },
  ];
  const eligibility = calibrationEligibility(fitCalibration(samples));
  assert.equal(eligibility.ok, false);
  assert.ok(eligibility.reasons.some((r) => r.includes('기울기')), eligibility.reasons.join('/'));
});

test('보정해도 오차가 줄지 않으면 승인할 수 없다', () => {
  // 예측이 이미 정확한 경우 — 보정할 이유가 없다.
  const samples = Array.from({ length: 8 }, (_, i) => ({ predicted: 500 + i * 10, observed: 500 + i * 10 }));
  const eligibility = calibrationEligibility(fitCalibration(samples));
  assert.equal(eligibility.ok, false);
  assert.ok(eligibility.reasons.some((r) => r.includes('오차가 줄지')), eligibility.reasons.join('/'));
});

test('표본이 모자라면 사유가 표본 수를 말해준다', () => {
  const eligibility = calibrationEligibility(null);
  assert.equal(eligibility.ok, false);
  assert.ok(eligibility.reasons[0].includes(String(MIN_CALIBRATION_SAMPLES)));
});

test('멀쩡한 편향 데이터는 승인 조건을 통과한다', () => {
  assert.equal(calibrationEligibility(fitCalibration(biasedSamples(6))).ok, true);
});

/* ============================== 승인 흐름 ============================== */

test('승인하지 않으면 예측에 반영되지 않는다', () => {
  const calibration = addCalibrationSamples(emptyCalibration(), 'encca', biasedSamples(6));
  assert.equal(activeCalibrationModels(calibration), null, '초안 적합은 적용되면 안 된다');

  const approved = setCalibrationApproval(calibration, 'encca', true);
  assert.equal(approved.ok, true);
  const models = activeCalibrationModels(approved.calibration);
  assert.ok(models.encca, '승인하면 적용되어야 한다');
  assert.equal(Object.keys(models).length, 1, '승인한 지표만 적용되어야 한다');
});

test('조건을 만족하지 않으면 승인 자체가 거부된다', () => {
  const calibration = addCalibrationSamples(emptyCalibration(), 'c20', biasedSamples(3));
  const result = setCalibrationApproval(calibration, 'c20', false === true ? false : true);
  assert.equal(result.ok, false);
  assert.ok(result.message.includes(String(MIN_CALIBRATION_SAMPLES)));
});

test('표본을 더하면 승인이 자동으로 풀린다', () => {
  // 승인한 사람이 본 데이터와 적용되는 데이터가 달라지면 안 된다.
  const approved = setCalibrationApproval(addCalibrationSamples(emptyCalibration(), 'rc', biasedSamples(6)), 'rc', true);
  assert.ok(activeCalibrationModels(approved.calibration).rc);

  const grown = addCalibrationSamples(approved.calibration, 'rc', [{ predicted: 120, observed: 110 }]);
  assert.equal(grown.metrics.rc.approved, false, '표본이 바뀌면 승인이 풀려야 한다');
  assert.equal(activeCalibrationModels(grown), null);
});

test('표본을 지워도 승인이 풀린다', () => {
  const withSamples = addCalibrationSamples(emptyCalibration(), 'saecca', biasedSamples(6));
  const approved = setCalibrationApproval(withSamples, 'saecca', true).calibration;
  const shrunk = removeCalibrationSample(approved, 'saecca', approved.metrics.saecca.samples[0].id);
  assert.equal(shrunk.metrics.saecca.approved, false);
  assert.equal(shrunk.metrics.saecca.samples.length, 5);
});

test('승인 후 데이터가 나빠지면 적용에서 자동으로 빠진다', () => {
  // 저장된 승인 플래그를 그대로 믿지 않고, 쓸 때마다 조건을 다시 본다.
  const approved = setCalibrationApproval(addCalibrationSamples(emptyCalibration(), 'encca', biasedSamples(6)), 'encca', true).calibration;
  const tampered = {
    ...approved,
    metrics: { ...approved.metrics, encca: { ...approved.metrics.encca, samples: biasedSamples(2) } },
  };
  assert.equal(tampered.metrics.encca.approved, true, '승인 플래그는 남아 있지만');
  assert.equal(activeCalibrationModels(tampered), null, '조건을 못 맞추면 적용되지 않아야 한다');
});

test('요약은 지표 4개를 항상 같은 순서로 돌려준다', () => {
  const summary = calibrationSummary(emptyCalibration());
  assert.deepEqual(summary.map((m) => m.key), ['c20', 'rc', 'encca', 'saecca']);
  assert.ok(summary.every((m) => m.fit === null && m.active === false));
});

/* ============================== 엔진 적용 ============================== */

const spec = {
  uid: 'u1', id: 'x', name: 'x', group: '12M24', type: 'PA',
  targetC20: 55, targetRc: 95, targetEnCca: 480, targetSaeCca: 500,
  maxPlates: 15, annualVolume: 20000, cellCount: 6,
};
const assumptions = { conversionCost: 14300, newToolingCost: 26000000, hybridToolingCost: 12000000, contingencyRate: 3 };
const designOf = (engine, kind = 'new') => engine.buildPlans([spec], 'balanced', assumptions).find((p) => p.kind === kind).designs[0];

test('보정을 넘기지 않으면 예측이 조금도 달라지지 않는다', () => {
  // parity.test 가 지키는 성질이지만, 보정 경로를 건드릴 때마다 여기서도 확인한다.
  const plain = designOf(createEngine(db));
  const explicitNull = designOf(createEngine(db, { calibration: null }));
  const emptyObject = designOf(createEngine(db, {}));
  for (const key of ['predictedC20', 'predictedRc', 'predictedEnCca', 'predictedSaeCca', 'plateCount', 'unitCost']) {
    assert.equal(explicitNull[key], plain[key], key);
    assert.equal(emptyObject[key], plain[key], key);
  }
});

test('보정식이 예측값에 실제로 반영된다', () => {
  // 보정이 걸리면 목표 충족 여부가 달라져 선택 매수 자체가 바뀔 수 있다.
  // 같은 매수끼리 비교해야 하므로, 매수 후보가 하나뿐인 스펙(상한=DB 최소매수)으로 고정한다.
  const [dbMin] = createEngine(db).plateCountRange(spec);
  const pinned = { ...spec, maxPlates: dbMin, targetC20: 1, targetRc: 1, targetEnCca: 1, targetSaeCca: 1 };
  const plain = createEngine(db).buildPlans([pinned], 'balanced', assumptions).find((p) => p.kind === 'new').designs[0];
  const scaled = createEngine(db, { calibration: { encca: { slope: 0.9, intercept: 0 } } })
    .buildPlans([pinned], 'balanced', assumptions).find((p) => p.kind === 'new').designs[0];
  assert.equal(scaled.plateCount, plain.plateCount, '비교 전제: 같은 매수여야 한다');
  // 결과 수치는 표시용으로 반올림되므로 1 이내면 같은 값이다.
  assert.ok(Math.abs(scaled.predictedEnCca - plain.predictedEnCca * 0.9) <= 1, `${scaled.predictedEnCca} vs ${plain.predictedEnCca}`);
  assert.equal(scaled.predictedSaeCca, plain.predictedSaeCca, '보정하지 않은 지표는 그대로여야 한다');
});

test('보정된 값 기준으로 성능여유가 다시 계산된다', () => {
  const plain = designOf(createEngine(db));
  const scaled = designOf(createEngine(db, { calibration: { encca: { slope: 0.9, intercept: 0 } } }));
  assert.ok(scaled.ccaMargin < plain.ccaMargin, '예측이 낮아졌으면 여유도 줄어야 한다');
});

test('용량 보정은 활물질 역산까지 일관되게 반영된다', () => {
  // 보정으로 예측이 깎이면 그만큼 활물질을 더 실어 목표를 다시 넘겨야 한다.
  // 출력만 깎고 역산을 안 하면 여유가 있는데도 목표 미달이 나온다.
  // 전제: 활물질 상한에 여유가 있는 제품군이어야 한다(12M24 는 상하한이 같아 역산이 보이지 않는다).
  // B24 는 실적 29건, 활물질 60~81 g/매로 여유가 있다. C20 이 역산을 지배하도록 RC 목표는 낮게 둔다.
  const modest = { ...spec, group: 'B24', targetC20: 34, targetRc: 5, targetEnCca: 1, targetSaeCca: 1, maxPlates: 20 };
  const plain = createEngine(db).buildPlans([modest], 'balanced', assumptions).find((p) => p.kind === 'new').designs[0];
  const design = createEngine(db, { calibration: { c20: { slope: 0.9, intercept: 0 } } })
    .buildPlans([modest], 'balanced', assumptions).find((p) => p.kind === 'new').designs[0];
  assert.ok(
    design.predictedC20 >= modest.targetC20 - 0.06 /* 표시 반올림 */,
    `보정 후에도 목표 ${modest.targetC20}를 충족해야 한다 (실제 ${design.predictedC20})`,
  );
  // 보상은 활물질 증량이나 매수 증가, 둘 중 하나로 나타난다. (실제로 B24 는 8매 활물질 상한에
  // 걸려 9매로 옮겨간다 — 보정이 설계 선택까지 바꾸는 살아있는 예다.)
  assert.ok(
    design.posActiveWeight > plain.posActiveWeight || design.plateCount > plain.plateCount,
    `보정으로 깎인 만큼 활물질(${plain.posActiveWeight}→${design.posActiveWeight}) 또는 매수(${plain.plateCount}→${design.plateCount})가 늘어야 한다`,
  );
});

test('보정이 세면 매수를 더 쓰는 쪽으로 설계가 바뀐다', () => {
  const plain = designOf(createEngine(db));
  // CCA 예측을 30% 깎으면 같은 매수로는 목표를 못 맞춘다.
  const harsh = designOf(createEngine(db, { calibration: { encca: { slope: 0.7, intercept: 0 } } }));
  assert.ok(harsh.plateCount >= plain.plateCount, `${harsh.plateCount} >= ${plain.plateCount}`);
});

test('기준품을 그대로 쓰는 경로의 실측값은 보정하지 않는다', () => {
  // 등록 제품의 성능은 예측이 아니라 실측이다. 여기에 보정을 걸면 DB를 왜곡한다.
  const engine = createEngine(db, { calibration: { encca: { slope: 0.5, intercept: 0 } } });
  const reference = db.products.find((p) => p.group === '12M24' && p.encca > 0 && p.assembly > 0);
  const lockedSpec = { ...spec, preferredReferenceCode: reference.code, maxPlates: Math.max(spec.maxPlates, reference.assembly) };
  const design = engine.buildPlans([lockedSpec], 'balanced', assumptions).find((p) => p.kind === 'existing').designs[0];
  assert.equal(design.reference.code, reference.code);
  assert.equal(design.predictedEnCca, reference.encca, '등록 실측값이 그대로 나와야 한다');
});

test('엔진이 지금 쓰는 보정식을 밖으로 알려준다', () => {
  assert.equal(createEngine(db).calibration, null);
  const models = { encca: { slope: 0.9, intercept: 0 } };
  assert.deepEqual(createEngine(db, { calibration: models }).calibration, models);
});

/* ============================== CSV ============================== */

test('한글·영문 열 이름으로 예측·실측 쌍을 읽는다', () => {
  const korean = parseCalibrationCsv('지표,제품,예측,실측\nEN CCA,시제품 A,540,512', 'c20');
  const english = parseCalibrationCsv('metric,product,predicted,observed\nencca,시제품 A,540,512', 'c20');
  assert.deepEqual(korean.rows, english.rows);
  assert.equal(korean.rows[0].metric, 'encca', '지표 열이 기본값보다 우선해야 한다');
  assert.equal(korean.rows[0].predicted, 540);
});

test('지표 열이 없으면 화면에서 고른 지표를 쓴다', () => {
  const parsed = parseCalibrationCsv('제품,예측,실측\n시제품 A,60,58.4', 'c20');
  assert.equal(parsed.rows[0].metric, 'c20');
});

test('한 파일에 여러 지표를 섞어 올릴 수 있다', () => {
  const parsed = parseCalibrationCsv('지표,제품,예측,실측\nEN CCA,A,540,512\nC20,A,60,58.4\nRC,A,105,99', 'c20');
  assert.deepEqual(parsed.rows.map((r) => r.metric), ['encca', 'c20', 'rc']);
});

test('읽을 수 없는 행은 행 번호와 사유를 남기고 건너뛴다', () => {
  const parsed = parseCalibrationCsv('지표,제품,예측,실측\nEN CCA,A,540,512\n엉뚱한지표,B,1,2\nEN CCA,C,없음,500', 'encca');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.issues[0].row, 3);
  assert.ok(parsed.issues[1].message.includes('예측값'));
});

test('양식 CSV는 그대로 읽힌다', () => {
  const csv = calibrationTemplateRows().map((row) => row.join(',')).join('\n');
  const parsed = parseCalibrationCsv(csv, 'encca');
  assert.equal(parsed.issues.length, 0);
  assert.deepEqual(parsed.rows.map((r) => r.metric), ['encca', 'c20']);
});

test('알 수 없는 지표로 표본을 넣으려 하면 막는다', () => {
  assert.throws(() => addCalibrationSamples(emptyCalibration(), 'weight', [{ predicted: 1, observed: 1 }]), /알 수 없는 지표/);
});
