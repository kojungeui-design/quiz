/**
 * test/safety.test.mjs — 조용히 틀리는 것을 막는 장치들.
 *
 * 여기 모인 것들의 공통점: 잘못된 값이나 실패가 <b>정상처럼</b> 처리되던 자리다.
 * 틀린 답보다 나쁜 것은 틀린 줄 모르는 답이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, parseThickness, DEFAULT_ASSUMPTIONS } from '../src/core/engine.js';
import { installDomStub } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));
const db = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};

/* ---------------------- 극판 두께 ---------------------- */

test('두께를 읽을 수 없으면 0.70T로 갈음하지 않고 null을 준다', () => {
  assert.equal(parseThickness('0.90T'), 0.9);
  assert.equal(parseThickness('1.00T'), 1);
  assert.equal(parseThickness(' 0.7 T '), 0.7);
  for (const bad of ['', '   ', 'ABC', '-', null, undefined, 'T', '0T', '0.0T']) {
    assert.equal(parseThickness(bad), null, `${JSON.stringify(bad)} 가 숫자로 둔갑했다`);
  }
});

test('내장 DB의 극판 두께는 전부 읽힌다', () => {
  const broken = db.plates.filter((p) => !(parseThickness(p.thickness) > 0));
  assert.equal(broken.length, 0, `읽을 수 없는 두께: ${broken.map((p) => p.code).join(', ')}`);
});

test('두께가 깨진 극판이 섞이면 설계를 계속하지 않고 막는다', () => {
  // 두께는 기판중량 → 납중량 → 원가 → CCA 두께계수로 이어진다.
  // 임의값으로 넘기면 그 뒤 숫자가 전부 "그럴듯한 거짓"이 된다.
  const ref = db.products.find((p) => p.posCode && p.negCode);
  const brokenDb = {
    ...db,
    plates: db.plates.map((p) => (p.code === ref.posCode ? { ...p, thickness: '' } : p)),
  };
  const engine = createEngine(brokenDb);
  const spec = {
    uid: 'T', id: 'T', name: '두께시험', group: ref.group, type: engine.technologyOf(ref.group),
    targetC20: ref.c20, targetRc: ref.rc, targetEnCca: ref.encca, targetSaeCca: ref.saecca,
    maxPlates: ref.assembly + 2, annualVolume: 1000, cellCount: 6,
  };
  const design = engine.calculateDesign(spec, 'existing', ref, DEFAULT_ASSUMPTIONS);
  assert.equal(design.compatibility.valid, false, '두께가 깨졌는데 설계가 계속됐다');
  assert.match(design.warning, /두께/);
  assert.equal(design.predictedLead, 0, '막힌 설계가 납중량을 내놓았다');
});

/* ---------------------- 자동저장 ---------------------- */

test('저장에 실패하면 미저장 상태를 유지한다', async () => {
  // 무조건 pending 을 내리던 때는, 저장 실패 후 창을 닫아도 경고가 뜨지 않아
  // 사용자가 아무 말 없이 작업을 잃었다.
  const dom = installDomStub();
  const { createAutosave } = await import('../src/core/storage.js');

  const states = [];
  const autosave = createAutosave({ getProjects: () => [{ id: 'x' }], onStateChange: (s) => states.push(s) });

  // 저장이 실패하도록 localStorage 를 막는다.
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  autosave.schedule();
  const failed = autosave.flush();
  assert.equal(failed.ok, false, '저장이 실패해야 하는 시험이다');
  assert.equal(autosave.hasPending, true, '저장 실패인데 미저장 표시가 사라졌다');
  assert.match(states[states.length - 1].label, /유지/);

  // 다시 저장에 성공하면 그때 내려간다.
  globalThis.localStorage.setItem = original;
  const ok = autosave.flush();
  assert.equal(ok.ok, true);
  assert.equal(autosave.hasPending, false, '저장에 성공했는데 미저장 표시가 남았다');
  dom.cleanup?.();
});

/* ---------------------- 제품군 표기 ---------------------- */

test('대소문자만 다른 제품군이 DB에 남아 있지 않다', () => {
  // D26(taxi) / D26(TAXI) 처럼 표기가 갈리면 같은 제품군의 학습 근거가 둘로 쪼개진다.
  const byKey = new Map();
  for (const p of db.products) {
    const key = String(p.group).trim().replace(/\s+/g, ' ').toUpperCase();
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(p.group);
  }
  const split = [...byKey.values()].filter((names) => names.size > 1).map((n) => [...n].join(' / '));
  assert.deepEqual(split, [], `표기가 갈린 제품군: ${split.join(', ')}`);
});
