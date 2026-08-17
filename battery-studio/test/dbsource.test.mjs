/**
 * test/dbsource.test.mjs — 사내 DB 임포트.
 *
 * 이 기능이 틀리면 잘못된 근거로 설계안이 나온다. 그래서 "받아들이는 것"보다
 * "반려하는 것"을 더 촘촘히 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCsv,
  detectKind,
  readImportFile,
  validateOverlay,
  applyOverlay,
  templateRows,
  exportRows,
} from '../src/core/dbsource.js';
import { createEngine } from '../src/core/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => JSON.parse(readFileSync(resolve(here, '..', 'data', 'source', name), 'utf8'));

const baseDb = {
  meta: src('meta.json'),
  groupOrder: src('group-order.json'),
  plates: src('plates.json'),
  products: src('products.json'),
  salesQty: src('sales-qty.json'),
};

/* ============================== CSV 파싱 ============================== */

test('따옴표 안의 쉼표와 줄바꿈을 지킨다', () => {
  const { header, rows } = parseCsv('code,name\nA1,"쉼표, 포함"\nA2,"두 줄\n이름"');
  assert.deepEqual(header, ['code', 'name']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '쉼표, 포함');
  assert.equal(rows[1].name, '두 줄\n이름');
});

test('BOM · CRLF · 빈 줄을 흡수한다', () => {
  const { header, rows } = parseCsv('﻿code,name\r\nA1,가\r\n\r\nA2,나\r\n');
  assert.deepEqual(header, ['code', 'name']);
  assert.equal(rows.length, 2, '빈 줄이 행으로 세어지면 안 된다');
  assert.equal(rows[0].code, 'A1');
});

test('세미콜론 구분자를 자동 판별한다', () => {
  // 지역 설정에 따라 엑셀이 세미콜론으로 내보내는 경우가 실제로 있다.
  const { header, rows } = parseCsv('code;name;width\nA1;가;138');
  assert.deepEqual(header, ['code', 'name', 'width']);
  assert.equal(rows[0].width, '138');
});

test('큰따옴표 이스케이프("")를 푼다', () => {
  const { rows } = parseCsv('code,name\nA1,"그는 ""예"" 라고 했다"');
  assert.equal(rows[0].name, '그는 "예" 라고 했다');
});

/* ============================== 종류 판별 · 열 매핑 ============================== */

test('제품 파일과 극판 파일을 헤더로 구분한다', () => {
  assert.equal(detectKind(['제품코드', '제품군', '양극코드', '조립매수']), 'products');
  assert.equal(detectKind(['code', 'width', 'height', 'thickness']), 'plates');
  assert.equal(detectKind(['code', 'name']), null, '판별 불가는 null 이어야 한다');
});

test('한글 열 이름과 영문 열 이름을 모두 인식한다', () => {
  const korean = readImportFile(
    '극판코드,폭,높이,두께,기판중량,활물질,단가,역할\nSLI90001,140,120,0.9T,40,100,450,양극',
    'a.csv',
  );
  const english = readImportFile(
    'code,width,height,thickness,baseWeight,activeWeight,cost,role\nSLI90001,140,120,0.9T,40,100,450,positive',
    'b.csv',
  );
  assert.equal(korean.kind, 'plates');
  // 역할 표기(양극/positive)만 다르고 나머지는 완전히 같게 읽혀야 한다.
  assert.deepEqual({ ...korean.rows[0], role: '' }, { ...english.rows[0], role: '' });
  // 표기 차이는 검증 단계에서 하나로 정리된다.
  const fromKorean = validateOverlay(baseDb, { plates: korean.rows }).plates[0];
  const fromEnglish = validateOverlay(baseDb, { plates: english.rows }).plates[0];
  assert.equal(fromKorean.role, 'positive');
  assert.deepEqual(fromKorean, fromEnglish);
});

test('필수 열이 없으면 읽기 단계에서 막는다', () => {
  assert.throws(
    () => readImportFile('제품코드,제품군,양극코드\nP1,12M24,SLI00070', 'x.csv'),
    /필수 열이 없습니다.*조립매수/,
  );
});

test('종류를 판별할 수 없는 파일은 사유를 알려준다', () => {
  assert.throws(() => readImportFile('code,name\nA,B', 'x.csv'), /판별하지 못했습니다/);
});

test('숫자로 읽을 수 없는 칸은 행 번호와 함께 보고한다', () => {
  const parsed = readImportFile('극판코드,폭,높이,두께\nSLI90001,백사십,120,0.9T', 'x.csv');
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].row, 2, '헤더가 1행이므로 첫 데이터는 2행이다');
  assert.match(parsed.issues[0].message, /폭 숫자 아님/);
});

test('천단위 쉼표가 든 숫자를 읽는다', () => {
  const parsed = readImportFile('제품코드,제품군,조립매수,양극코드,음극코드,판매수량\nP1,G,13,X,Y,"12,000"', 'x.csv');
  assert.equal(parsed.rows[0].salesQty, 12000);
  assert.equal(parsed.issues.length, 0);
});

/* ============================== 검증 ============================== */

const plateRow = (over = {}) => ({
  code: 'SLI90001', name: '신규 양극', width: 140, height: 120, thickness: '0.90T',
  baseWeight: 40, activeWeight: 100, cost: 450, role: '양극', ...over,
});
const productRow = (over = {}) => ({
  code: 'PCF90001', name: '신규 제품', group: '12M24', type: 'PM',
  c20: 60, rc: 105, encca: 540, saecca: 570, assembly: 13,
  posCode: 'SLI00070', posQty: 7, negCode: 'SLI00071', negQty: 6,
  L: 242, W: 175, H: 190, weight: 15.2, lead: 8.1, observations: 2, salesQty: 9000, ...over,
});

test('등록되지 않은 극판을 참조하는 제품은 반려한다', () => {
  const result = validateOverlay(baseDb, { products: [productRow({ posCode: 'NOPE' })] });
  assert.equal(result.products.length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /양극 NOPE 미등록/);
});

test('같은 파일 안의 코드 중복은 반려한다', () => {
  const result = validateOverlay(baseDb, { products: [productRow(), productRow()] });
  assert.equal(result.products.length, 1, '먼저 나온 한 건만 받는다');
  assert.match(result.issues[0].message, /코드 중복/);
});

test('조립매수가 0 이하인 제품은 반려한다', () => {
  const result = validateOverlay(baseDb, { products: [productRow({ assembly: 0 })] });
  assert.equal(result.products.length, 0);
  assert.match(result.issues[0].message, /조립매수 이상/);
});

test('치수가 없는 극판은 반려한다', () => {
  const result = validateOverlay(baseDb, { plates: [plateRow({ width: 0 })] });
  assert.equal(result.plates.length, 0);
  assert.match(result.issues[0].message, /치수 이상/);
});

test('같이 올린 새 극판을 참조하는 제품은 통과한다', () => {
  // 제품 파일만 먼저 검증하면 "극판 미등록"이 뜨는데, 두 파일을 함께 올리면 통과해야 한다.
  const staged = {
    plates: [plateRow({ code: 'SLI90001' }), plateRow({ code: 'SLI90002', role: '음극' })],
    products: [productRow({ posCode: 'SLI90001', negCode: 'SLI90002' })],
  };
  const result = validateOverlay(baseDb, staged);
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
  assert.equal(result.products.length, 1);
  assert.equal(result.plates.length, 2);
});

test('반려된 행이 있어도 정상 행은 살아남는다', () => {
  const result = validateOverlay(baseDb, {
    products: [productRow(), productRow({ code: 'PCF90002', assembly: -1 })],
  });
  assert.equal(result.products.length, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.summary.productsRead, 2);
  assert.equal(result.summary.productsAccepted, 1);
});

test('빠진 값은 기존 값 → 보수적 기본값 순으로 채운다', () => {
  const existing = baseDb.products[0];
  const result = validateOverlay(baseDb, {
    products: [{ ...productRow({ code: existing.code }), name: '', weight: null, observations: null }],
  });
  const merged = result.products[0];
  assert.equal(merged.name, existing.name, '이름이 비면 기존 이름을 지킨다');
  assert.equal(merged.weight, existing.weight, '중량이 비면 기존 값을 지킨다');
  assert.equal(merged.observations, existing.observations, '실적건수가 비면 기존 값을 지킨다');

  const fresh = validateOverlay(baseDb, { products: [productRow({ observations: null })] }).products[0];
  assert.equal(fresh.observations, 1, '신규 제품의 실적건수 기본값은 1이다');
});

test('역할(양극/음극)은 한글 표기도 받는다', () => {
  const result = validateOverlay(baseDb, {
    plates: [plateRow({ role: '음극' }), plateRow({ code: 'SLI90002', role: 'both' })],
  });
  assert.equal(result.plates[0].role, 'negative');
  assert.equal(result.plates[1].role, 'both');
});

test('새 극판은 극성을 밝혀야 한다 — 활물질 허용범위가 극성으로 정해지기 때문', () => {
  const result = validateOverlay(baseDb, { plates: [plateRow({ code: 'SLI90003', role: '' })] });
  assert.equal(result.plates.length, 0, '극성 없는 새 극판이 통과했다');
  assert.match(result.issues[0].message, /극성/);
});

test('내장 DB의 미분류 극판은 대체 모드에서도 반려되지 않는다', () => {
  // "현재 극판 내보내기 → 고쳐서 다시 올리기"가 정상 작업이다. 내장 DB에는 미분류 극판이
  // 48종 있는데, 이것들이 반려되면 그 극판과 그것을 쓰는 제품이 통째로 사라진다.
  const unknownPlates = baseDb.plates.filter((p) => p.role === 'unknown');
  assert.ok(unknownPlates.length, '내장 DB에 미분류 극판이 있어야 이 테스트가 의미 있다');
  const result = validateOverlay(baseDb, { plates: baseDb.plates.map((p) => ({ ...p })) }, 'replace');
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues.slice(0, 3)));
  assert.equal(result.plates.length, baseDb.plates.length);
});

/* ============================== 병합 · 대체 ============================== */

test('병합 모드는 올리지 않은 기존 데이터를 그대로 둔다', () => {
  const result = validateOverlay(baseDb, { products: [productRow()] }, 'merge');
  const merged = applyOverlay(baseDb, { mode: 'merge', ...result });
  assert.equal(merged.products.length, baseDb.products.length + 1);
  assert.equal(merged.plates.length, baseDb.plates.length);
  assert.ok(merged.products.some((p) => p.code === 'PCF90001'));
});

test('대체 모드는 올린 종류만 통째로 바꾼다', () => {
  const result = validateOverlay(baseDb, { products: [productRow()] }, 'replace');
  const replaced = applyOverlay(baseDb, { mode: 'replace', ...result });
  assert.equal(replaced.products.length, 1, '제품은 올린 것만 남는다');
  assert.equal(replaced.plates.length, baseDb.plates.length, '올리지 않은 극판은 그대로다');
});

test('대체 모드에서 사라진 제품의 판매수량은 남지 않는다', () => {
  const result = validateOverlay(baseDb, { products: [productRow()] }, 'replace');
  const replaced = applyOverlay(baseDb, { mode: 'replace', ...result });
  assert.deepEqual(Object.keys(replaced.salesQty), ['PCF90001']);
  assert.equal(replaced.salesQty.PCF90001, 9000);
});

test('참조가 깨진 제품은 반영 결과에서 빠진다', () => {
  // 극판을 통째로 바꿔 기존 제품들의 참조를 끊어본다.
  const plates = validateOverlay(baseDb, { plates: [plateRow(), plateRow({ code: 'SLI90002' })] }, 'replace');
  const applied = applyOverlay(baseDb, { mode: 'replace', ...plates });
  assert.equal(applied.products.length, 0, '참조가 끊긴 제품은 남으면 안 된다');
  assert.equal(applied.plates.length, 2);
});

test('극판 사용 제품 수(usage)를 다시 센다', () => {
  const staged = {
    plates: [plateRow({ code: 'SLI90001' }), plateRow({ code: 'SLI90002', role: '음극' })],
    products: [
      productRow({ code: 'PCF90001', posCode: 'SLI90001', negCode: 'SLI90002' }),
      productRow({ code: 'PCF90002', posCode: 'SLI90001', negCode: 'SLI90002' }),
    ],
  };
  const result = validateOverlay(baseDb, staged, 'replace');
  const applied = applyOverlay(baseDb, { mode: 'replace', ...result });
  const plate = applied.plates.find((p) => p.code === 'SLI90001');
  assert.equal(plate.usage, 2, '새 극판을 쓰는 제품이 2건이면 usage도 2여야 한다');
});

test('오버레이가 없으면 내장 DB를 그대로 돌려준다', () => {
  assert.equal(applyOverlay(baseDb, null), baseDb);
  assert.equal(applyOverlay(baseDb, { mode: 'merge', products: [], plates: [] }), baseDb);
});

test('내장 DB 객체는 절대 변형되지 않는다', () => {
  const before = { products: baseDb.products.length, plates: baseDb.plates.length, sales: Object.keys(baseDb.salesQty).length };
  const result = validateOverlay(baseDb, { products: [productRow()] }, 'replace');
  applyOverlay(baseDb, { mode: 'replace', ...result });
  assert.equal(baseDb.products.length, before.products);
  assert.equal(baseDb.plates.length, before.plates);
  assert.equal(Object.keys(baseDb.salesQty).length, before.sales);
});

/* ============================== 엔진 연결 ============================== */

test('임포트한 제품이 엔진의 근거로 실제로 쓰인다', () => {
  const groupCode = 'BDS-TEST';
  const staged = {
    plates: [
      plateRow({ code: 'SLI90001', role: '양극' }),
      plateRow({ code: 'SLI90002', role: '음극' }),
    ],
    products: [10, 11, 12, 13].map((assembly, index) =>
      productRow({
        code: `PCF9000${index}`,
        group: groupCode,
        assembly,
        posCode: 'SLI90001',
        negCode: 'SLI90002',
        posQty: Math.ceil(assembly / 2),
        negQty: Math.floor(assembly / 2),
        c20: 45 + assembly,
        rc: 80 + assembly * 2,
        encca: 400 + assembly * 10,
        saecca: 420 + assembly * 10,
      }),
    ),
  };
  const result = validateOverlay(baseDb, staged, 'merge');
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));

  const beforeEngine = createEngine(baseDb);
  assert.equal(beforeEngine.learningByGroup.has(groupCode), false, '임포트 전에는 없던 제품군이어야 한다');

  const afterEngine = createEngine(applyOverlay(baseDb, { mode: 'merge', ...result }));
  assert.ok(afterEngine.learningByGroup.has(groupCode), '임포트한 제품군이 학습 대상에 들어와야 한다');
  assert.equal(afterEngine.dbStats.references, baseDb.products.length + 4);

  const learning = afterEngine.learningByGroup.get(groupCode);
  assert.equal(learning.assembly.min, 10);
  assert.equal(learning.assembly.max, 13);

  // 실제로 설계안이 계산되는지까지 확인한다. 여기서 막히면 임포트는 성공해도 쓸모가 없다.
  const plans = afterEngine.buildPlans(
    // type 은 제품군의 기술 분류(PA/AGM/EFB)다. 제품 레코드의 type(PM/PS)과는 다른 값이다.
    [{
      uid: 'u1', id: '신규', name: '신규', group: groupCode, type: 'PA',
      targetC20: 55, targetRc: 100, targetEnCca: 500, targetSaeCca: 520,
      maxPlates: 13, annualVolume: 20000, cellCount: 6,
    }],
    'balanced',
    { conversionCost: 14300, newToolingCost: 26000000, hybridToolingCost: 12000000, contingencyRate: 3 },
  );
  const design = plans.find((p) => p.kind === 'existing').designs[0];
  assert.ok(design.predictedEnCca > 0, `EN CCA가 예측되어야 한다 (${design.warning || ''})`);
  assert.ok(design.unitCost > 0, '원가가 계산되어야 한다');
  assert.equal(design.posCode, 'SLI90001', '임포트한 극판이 설계에 쓰여야 한다');
});

test('임포트 DB 기준 백테스트도 돌아간다', () => {
  const result = validateOverlay(baseDb, { products: [productRow()] }, 'merge');
  const engine = createEngine(applyOverlay(baseDb, { mode: 'merge', ...result }));
  const backtest = engine.backtest('c20');
  assert.ok(backtest.samples > 0);
  assert.ok(Number.isFinite(backtest.mape));
});

/* ============================== 양식 · 내보내기 왕복 ============================== */

test('내보낸 CSV를 그대로 다시 읽을 수 있다', () => {
  const rows = exportRows(baseDb, 'plates');
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const parsed = readImportFile(csv, 'roundtrip.csv');
  assert.equal(parsed.kind, 'plates');
  assert.equal(parsed.rows.length, baseDb.plates.length);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows[0].code, baseDb.plates[0].code);
  assert.equal(parsed.rows[0].width, baseDb.plates[0].width);

  // 왕복한 데이터는 검증도 통과해야 한다. 통과하지 못하면 "받은 파일을 되돌려줄 수 없다"는 뜻이다.
  const result = validateOverlay(baseDb, { plates: parsed.rows }, 'replace');
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues.slice(0, 3)));
});

test('제품 CSV 왕복도 검증을 통과한다', () => {
  const rows = exportRows(baseDb, 'products');
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const parsed = readImportFile(csv, 'roundtrip.csv');
  const result = validateOverlay(baseDb, { products: parsed.rows }, 'replace');
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues.slice(0, 3)));
  assert.equal(result.products.length, baseDb.products.length);
});

test('양식 CSV는 읽기와 검증을 모두 통과한다', () => {
  for (const kind of ['products', 'plates']) {
    const rows = templateRows(kind);
    const csv = rows.map((row) => row.join(',')).join('\n');
    const parsed = readImportFile(csv, `${kind}.csv`);
    assert.equal(parsed.kind, kind, `${kind} 양식의 종류가 잘못 판별된다`);
    assert.equal(parsed.issues.length, 0, `${kind} 양식에 숫자 오류가 있다`);
  }
  // 제품 양식은 자기 양식의 극판을 참조하므로, 둘을 함께 올리면 통과해야 한다.
  const plates = readImportFile(templateRows('plates').map((r) => r.join(',')).join('\n'), 'p.csv');
  const products = readImportFile(templateRows('products').map((r) => r.join(',')).join('\n'), 'q.csv');
  const result = validateOverlay(baseDb, { plates: plates.rows, products: products.rows });
  const missing = result.issues.filter((x) => /미등록/.test(x.message));
  assert.equal(missing.length, 1, '예시 제품의 음극(SLI09002)만 미등록으로 걸려야 한다');
});
