/**
 * test/parity.test.mjs — 신엔진이 구엔진과 같은 숫자를 내는지 전수 대조.
 *
 *   node --test test/
 *
 * 의도적으로 다르게 만든 부분(engine.js 상단 "이식 시 수정한 것")은 bugfix.test.mjs 에서
 * 반대로 "달라야 한다"를 검증한다. 여기서는 정상 입력에 대해 완전 일치를 요구한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as legacy from './fixtures/legacy-engine.generated.mjs';
import { createEngine } from '../src/core/engine.js';

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

/** 제품군 학습값을 목표로 삼아 현실적인 스펙을 만든다. */
function specForGroup(group, index = 0) {
  const learn = engine.learningByGroup.get(group);
  return {
    id: group,
    group,
    type: engine.technologyOf(group),
    targetC20: learn.performance.c20.typical || 50,
    targetRc: learn.performance.rc.typical || 90,
    targetEnCca: learn.performance.enCca.typical || 500,
    targetSaeCca: learn.performance.saeCca.typical || 520,
    maxPlates: learn.assembly.max || 15,
    annualVolume: 10000 + index * 2500,
  };
}
const allGroups = engine.groups.map((g) => g.group);
const allSpecs = allGroups.map((g, i) => specForGroup(g, i));

const DESIGN_FIELDS = [
  'plateCount', 'posCount', 'negCount',
  'predictedC20', 'predictedRc', 'predictedEnCca', 'predictedSaeCca',
  'c20Margin', 'rcMargin', 'ccaMargin', 'saeMargin',
  'posCode', 'negCode', 'posName', 'negName', 'posThickness', 'negThickness',
  'sourcePosThickness', 'sourceNegThickness',
  'ccaThicknessFactor', 'posGridWeight', 'negGridWeight', 'posActiveWeight',
  'parallelPlateArea', 'resistanceIndex', 'ccaEvidenceProducts',
  'unitCost', 'confidence', 'evidenceGrade', 'selectionReason', 'warning',
];
const PLAN_FIELDS = [
  'kind', 'label', 'shortLabel', 'description', 'averageCost', 'developmentCost',
  'developmentMonths', 'commonFamilies', 'commonization', 'commonizedVolumeShare',
  'toolingFamilies', 'score', 'risk',
];

function assertDesignEqual(actual, expected, where) {
  for (const field of DESIGN_FIELDS) {
    assert.deepEqual(actual[field], expected[field], `${where} · ${field}`);
  }
  assert.equal(actual.reference.code, expected.reference.code, `${where} · reference.code`);
  assert.equal(actual.compatibility.valid, expected.compatibility.valid, `${where} · compatibility.valid`);
  assert.equal(actual.compatibility.familyKey, expected.compatibility.familyKey, `${where} · familyKey`);
  assert.equal(actual.compatibility.familyLabel, expected.compatibility.familyLabel, `${where} · familyLabel`);
  assert.equal(actual.compatibility.rule, expected.compatibility.rule, `${where} · rule`);
  assert.deepEqual(actual.dbPlateRange, expected.dbPlateRange, `${where} · dbPlateRange`);
  assert.deepEqual(actual.evaluatedPlateCounts, expected.evaluatedPlateCounts, `${where} · evaluatedPlateCounts`);
  assert.deepEqual(actual.posActiveRange, expected.posActiveRange, `${where} · posActiveRange`);
}

test('제품군 호환성 프로필이 83개 제품군 전부 일치한다', () => {
  for (const group of allGroups) {
    const mine = engine.groupProfile(group);
    const theirs = legacy.fl(group);
    assert.equal(mine.technology, theirs.technology, group);
    assert.equal(mine.valid, theirs.valid, group);
    assert.equal(mine.reason, theirs.reason, group);
    assert.equal(mine.references, theirs.references, group);
    assert.equal(mine.observations, theirs.observations, group);
    assert.equal(mine.currentProducts, theirs.currentProducts, group);
    assert.equal(mine.currentSalesQty, theirs.currentSalesQty, group);
    assert.deepEqual(mine.positiveCodes, theirs.positiveCodes, group);
    assert.deepEqual(mine.negativeCodes, theirs.negativeCodes, group);
    assert.deepEqual(mine.positiveSizes.map((s) => s.key), theirs.positiveSizes.map((s) => s.key), group);
    assert.deepEqual(mine.pairs.map((p) => p.key), theirs.pairs.map((p) => p.key), group);
  }
});

test('제품군 학습값(대표성능·매수·근거등급)이 전부 일치한다', () => {
  for (const group of allGroups) {
    const mine = engine.learningByGroup.get(group);
    const theirs = legacy.pa.find((g) => g.group === group);
    assert.deepEqual(mine.assembly, theirs.assembly, `${group} assembly`);
    assert.deepEqual(mine.performance, theirs.performance, `${group} performance`);
    assert.equal(mine.evidenceGrade, theirs.evidenceGrade, `${group} grade`);
    assert.equal(mine.learningBasis, theirs.learningBasis, `${group} basis`);
    assert.equal(mine.currentSalesQty, theirs.currentSalesQty, `${group} salesQty`);
    assert.deepEqual(mine.observedPlateCounts, theirs.observedPlateCounts, `${group} plateCounts`);
    assert.deepEqual(mine.metricCoverage, theirs.metricCoverage, `${group} coverage`);
    assert.deepEqual(
      mine.topDesigns.map((d) => `${d.posCode}|${d.negCode}|${d.assembly}`),
      theirs.topDesigns.map((d) => `${d.posCode}|${d.negCode}|${d.assembly}`),
      `${group} topDesigns`,
    );
  }
});

test('기존 PCC 매칭 결과가 83개 제품군 전부 일치한다', () => {
  for (const spec of allSpecs) {
    const mine = engine.matchExisting(spec, 5);
    const theirs = legacy.Bn(spec, 5);
    assert.equal(mine.length, theirs.length, `${spec.group} 후보 수`);
    mine.forEach((m, i) => {
      const t = theirs[i];
      assert.equal(m.reference.code, t.reference.code, `${spec.group} #${i} code`);
      assert.equal(m.directFit, t.directFit, `${spec.group} #${i} directFit`);
      assert.equal(m.score, t.score, `${spec.group} #${i} score`);
      assert.deepEqual(m.missingMetrics, t.missingMetrics, `${spec.group} #${i} missing`);
      assert.deepEqual(m.margins, t.margins, `${spec.group} #${i} margins`);
    });
  }
});

test('제품군 단품 설계안 3종이 83개 제품군 전부 일치한다', () => {
  for (const spec of allSpecs) {
    const mine = engine.buildPlans([spec], 'balanced', assumptions);
    const theirs = legacy.An([spec], 'balanced', assumptions);
    mine.forEach((plan, i) => {
      for (const field of PLAN_FIELDS) {
        assert.deepEqual(plan[field], theirs[i][field], `${spec.group} ${plan.kind} · ${field}`);
      }
      assertDesignEqual(plan.designs[0], theirs[i].designs[0], `${spec.group} ${plan.kind}`);
    });
  }
});

test('83개 제품 대형 라인업의 공용화 배정이 일치한다', () => {
  for (const objective of ['balanced', 'cost', 'performance']) {
    const mine = engine.buildPlans(allSpecs, objective, assumptions);
    const theirs = legacy.An(allSpecs, objective, assumptions);
    mine.forEach((plan, i) => {
      for (const field of PLAN_FIELDS) {
        assert.deepEqual(plan[field], theirs[i][field], `${objective} ${plan.kind} · ${field}`);
      }
      assert.equal(plan.designs.length, theirs[i].designs.length);
      plan.designs.forEach((design, j) => {
        assertDesignEqual(design, theirs[i].designs[j], `${objective} ${plan.kind} #${allSpecs[j].group}`);
      });
    });
    assert.deepEqual(engine.rankPlans(mine, objective), legacy.Ai(theirs, objective), `${objective} 순위`);
  }
});

test('기준품을 직접 지정한 3안(등록 BOM 고정)도 일치한다', () => {
  const picked = allSpecs
    .map((spec) => {
      const candidates = engine.candidatesFor(spec);
      return candidates.length ? { ...spec, preferredReferenceCode: candidates[0].code } : null;
    })
    .filter(Boolean);
  assert.ok(picked.length > 50, '표본이 충분해야 한다');

  const mine = engine.buildPlans(picked, 'cost', assumptions);
  const theirs = legacy.An(picked, 'cost', assumptions);
  mine.forEach((plan, i) => {
    plan.designs.forEach((design, j) => {
      assertDesignEqual(design, theirs[i].designs[j], `preferred ${plan.kind} #${picked[j].group}`);
    });
  });
});

test('호환 조합이 없는 제품군은 양쪽 모두 동일하게 차단된다', () => {
  // 기술 분류가 어긋나는 스펙을 만들어 강제로 차단 경로를 탄다.
  const blocked = allSpecs.slice(0, 20).map((spec) => ({
    ...spec,
    type: engine.technologyOf(spec.group) === 'PA' ? 'AGM' : 'PA',
  }));
  const mine = engine.buildPlans(blocked, 'balanced', assumptions);
  const theirs = legacy.An(blocked, 'balanced', assumptions);
  mine.forEach((plan, i) => {
    plan.designs.forEach((design, j) => {
      assert.equal(design.compatibility.valid, false);
      assertDesignEqual(design, theirs[i].designs[j], `blocked ${plan.kind} #${blocked[j].group}`);
    });
  });
});

test('DB 백테스트(MAPE)가 4개 지표 모두 일치한다', () => {
  assert.deepEqual(engine.backtest('c20'), legacy.Sn('c20'), 'C20');
  assert.deepEqual(engine.backtest('rc'), legacy.Sn('rc'), 'RC');
  assert.deepEqual(engine.backtest('encca'), legacy.Sn('encca'), 'EN CCA');
  assert.deepEqual(engine.backtest('saecca'), legacy.Sn('saecca'), 'SAE CCA');
});

test('DB 통계가 일치한다', () => {
  assert.equal(engine.dbStats.references, legacy.Za.references);
  assert.equal(engine.dbStats.plates, legacy.Za.plates);
  assert.equal(engine.dbStats.groups, legacy.Za.groups);
  assert.equal(engine.dbStats.readyCurrentGroups, legacy.Za.readyCurrentGroups);
  assert.deepEqual(engine.dbStats.missing, legacy.Za.missing);
});
