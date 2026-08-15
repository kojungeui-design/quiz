/**
 * test/obsolete.test.mjs — 극판 단종·신규 추가.
 *
 * 이 기능의 전부는 한 문장이다: <b>단종은 "쓰지 마라"이지 "없었다"가 아니다.</b>
 *
 * 지켜야 할 성질
 *   1. 단종 극판은 신규 설계 후보에서 빠진다 — 단, 그 극을 실제로 사다 쓰는 안에서만.
 *   2. 단종 극판의 실적은 학습 근거로 그대로 남는다 (예측이 흔들리면 안 된다).
 *   3. 상태를 안 적은 기존 DB 는 전부 "사용 중"이다 (기존 동작과 완전히 같아야 한다).
 *   4. 극판 마스터에서 줄을 지우는 방식은 실적을 파괴한다 — 그래서 상태로 다룬다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, DEFAULT_ASSUMPTIONS } from '../src/core/engine.js';
import { applyOverlay, isActiveStatus } from '../src/core/dbsource.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));
const baseDb = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};

/** 극판 하나를 단종 표시한 DB. 줄을 지우지 않고 상태만 바꾼다. */
const withStatus = (code, status) => ({
  ...baseDb,
  plates: baseDb.plates.map((p) => (p.code === code ? { ...p, status } : p)),
});

/**
 * 단종 시험 대상 두 가지.
 *   ALT   그 제품군에 대안이 남는 극판 — 후보에서 빠지는지 본다.
 *   DEAD  그 제품군 전부가 쓰는 극판 — 지웠을 때 실적이 얼마나 무너지는지 본다.
 */
const ALT = 'SLI01497';
const altGroup = baseDb.products.find((p) => p.posCode === ALT || p.negCode === ALT).group;

const DEAD = 'SLI00070';
const deadUsers = baseDb.products.filter((p) => p.posCode === DEAD || p.negCode === DEAD);
const group = deadUsers[0].group;

const specOf = (g, engine) => {
  const ref = baseDb.products.find((p) => p.group === g);
  return {
    uid: 'X', id: 'X', name: '시험제품', group: g, type: engine.technologyOf(g),
    targetC20: ref.c20, targetRc: ref.rc, targetEnCca: ref.encca, targetSaeCca: ref.saecca,
    maxPlates: ref.assembly + 2, annualVolume: 10000, cellCount: 6,
  };
};

test('상태를 안 적으면 전부 사용 중 — 기존 DB 동작이 그대로다', () => {
  const engine = createEngine(baseDb);
  assert.ok(baseDb.plates.every((p) => engine.isPlateActive(p.code)), '기존 극판이 단종으로 잡혔다');
  assert.ok(isActiveStatus(''), '빈 상태는 사용 중이어야 한다');
  assert.ok(isActiveStatus('사용중'));
  assert.ok(!isActiveStatus('단종'));
});

test('단종 극판은 3안(기존 극판) 설계 후보에서 빠진다', () => {
  const engine = createEngine(withStatus(ALT, '단종'));
  const spec = specOf(altGroup, engine);
  const before = createEngine(baseDb).designCandidatesFor(spec, 'existing');
  const after = engine.designCandidatesFor(spec, 'existing');
  assert.ok(before.some((r) => r.posCode === ALT || r.negCode === ALT), '원래는 후보에 있어야 한다');
  assert.ok(!after.some((r) => r.posCode === ALT || r.negCode === ALT), '단종인데 후보에 남았다');
  assert.ok(after.length, '대안이 있는데 후보가 비었다');
});

test('1안(신형)은 양·음극을 새로 만드므로 단종과 무관하다', () => {
  const engine = createEngine(withStatus(ALT, '단종'));
  const spec = specOf(altGroup, engine);
  assert.equal(
    engine.designCandidatesFor(spec, 'new').length,
    engine.candidatesFor(spec).length,
    '신형 설계인데 단종 때문에 후보가 줄었다',
  );
});

test('2안(하이브리드)은 음극만 사다 쓰므로 양극 단종은 무시한다', () => {
  // 양극만 단종인 극판을 찾아, 하이브리드(양극 신형) 후보는 줄지 않는지 본다.
  const posOnly = baseDb.products.find((p) => {
    const peers = baseDb.products.filter((x) => x.group === p.group);
    const alternatives = peers.filter((x) => x.posCode !== p.posCode && x.negCode !== p.posCode);
    // 양극으로만 쓰이고, 같은 제품군에 그 극판을 안 쓰는 대안이 남아 있어야 한다.
    return alternatives.length >= 2 && !baseDb.products.some((x) => x.negCode === p.posCode);
  });
  assert.ok(posOnly, '양극 전용 극판을 찾지 못했다');
  const engine = createEngine(withStatus(posOnly.posCode, '단종'));
  const spec = specOf(posOnly.group, engine);
  assert.equal(
    engine.designCandidatesFor(spec, 'hybrid').length,
    engine.candidatesFor(spec).length,
    '양극이 단종인데 하이브리드 후보가 줄었다 — 하이브리드는 양극을 새로 만든다',
  );
  assert.ok(
    !engine.designCandidatesFor(spec, 'existing').some((r) => r.posCode === posOnly.posCode),
    '3안은 양극도 사다 쓰므로 걸러져야 한다',
  );
});

test('단종 극판의 실적은 학습 근거로 그대로 남는다', () => {
  const plain = createEngine(baseDb);
  const marked = createEngine(withStatus(DEAD, '단종'));

  // DB 규모가 줄지 않아야 한다 — 삭제가 아니라 표시이므로.
  assert.equal(marked.products.length, plain.products.length, '제품 실적이 사라졌다');
  assert.equal(marked.plates.length, plain.plates.length, '극판이 사라졌다');
  assert.equal(marked.groups.length, plain.groups.length, '제품군이 사라졌다');

  // 매수 실적 범위와 근거 집합도 그대로여야 한다.
  const spec = specOf(group, marked);
  assert.deepEqual(marked.plateCountRange(spec), plain.plateCountRange(spec), '실적 매수범위가 달라졌다');

  // 1안 예측은 단종과 무관하므로 수치가 완전히 같아야 한다.
  const refs = plain.assignReferences([spec], 'new');
  const a = plain.calculateDesign(spec, 'new', refs[0], DEFAULT_ASSUMPTIONS);
  const b = marked.calculateDesign(spec, 'new', refs[0], DEFAULT_ASSUMPTIONS);
  assert.equal(b.predictedC20, a.predictedC20);
  assert.equal(b.predictedEnCca, a.predictedEnCca);
  assert.equal(b.predictedLead, a.predictedLead);
});

test('그 제품군 극판이 모두 단종이면 막지 않고 경고한다', () => {
  const codes = new Set();
  baseDb.products.filter((p) => p.group === group).forEach((p) => { codes.add(p.posCode); codes.add(p.negCode); });
  const allDead = { ...baseDb, plates: baseDb.plates.map((p) => (codes.has(p.code) ? { ...p, status: '단종' } : p)) };
  const engine = createEngine(allDead);
  const spec = specOf(group, engine);

  const refs = engine.assignReferences([spec], 'existing');
  assert.ok(refs[0], '후보가 아예 없어 계산이 막혔다');
  const design = engine.calculateDesign(spec, 'existing', refs[0], DEFAULT_ASSUMPTIONS);
  assert.ok(design.obsoletePlates.length, '단종 극판을 썼는데 표시가 없다');
  assert.match(design.warning || '', /단종/, '단종 경고가 없다');
});

test('신규 극판은 병합 임포트 한 줄로 추가된다', () => {
  const added = applyOverlay(baseDb, {
    mode: 'merge',
    plates: [{ code: 'NEW-TEST-01', name: '신규시험극판', width: 138, height: 118, thickness: '0.80T', baseWeight: 40, activeWeight: 100, cost: 500, role: 'positive', status: '' }],
    products: [],
    salesQty: {},
  });
  assert.equal(added.plates.length, baseDb.plates.length + 1, '극판이 추가되지 않았다');
  assert.equal(added.products.length, baseDb.products.length, '제품 실적이 건드려졌다');
  assert.ok(createEngine(added).isPlateActive('NEW-TEST-01'), '새 극판이 사용 중이 아니다');
});

test('단종을 삭제로 처리하면 실적이 무너진다 — 그래서 상태로 다룬다', () => {
  // 이 테스트는 "왜 이렇게 만들었는가"를 코드로 남겨둔다. 나중에 누가 삭제 방식으로
  // 되돌리려 할 때, 그 대가가 무엇인지 숫자로 보이게 한다.
  const deleted = applyOverlay(baseDb, {
    mode: 'replace',
    plates: baseDb.plates.filter((p) => p.code !== DEAD),
    products: [],
    salesQty: {},
  });
  assert.ok(deleted.products.length < baseDb.products.length, '삭제인데 제품이 그대로다');
  assert.equal(deleted.products.length, baseDb.products.length - deadUsers.length);

  const marked = withStatus(DEAD, '단종');
  assert.equal(marked.products.length, baseDb.products.length, '상태 표시는 실적을 건드리면 안 된다');
});
