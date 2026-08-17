/**
 * src/core/dbsource.js — 사내 DB를 앱 안에서 갱신한다.
 *
 * 왜 필요한가: 내장 DB는 빌드 시점(data/source/*.json)에 고정된다. 갱신하려면 Node 와
 * 빌드 절차가 필요한데, 정작 이 도구를 쓰는 설계자 PC 에는 Node 가 없다. 그래서 DB 갱신이
 * 매번 개발자 호출이 되고, 결국 DB 가 낡은 채로 방치된다.
 *
 * 방식: 내장 DB 를 건드리지 않고 그 "위에 덮는" 오버레이를 브라우저에 저장한다.
 *   내장 DB(빌드 산출물)  +  오버레이(사용자 임포트)  →  엔진에 넘길 DB
 * 오버레이는 언제든 해제하면 내장 DB 그대로 돌아온다. 되돌릴 수 없는 상태를 만들지 않는다.
 *
 * 검증 규칙은 data/build-db.mjs 의 빌드 정합성 검사와 같은 것을 쓴다. 빌드로 들어갔다면
 * 통과했을 데이터만 앱에서도 받아들인다는 뜻이다.
 */

const OVERLAY_KEY = 'bds-v8-db-overlay';
const OVERLAY_SCHEMA = 'bds-overlay-v1';

/* ============================== CSV 읽기 ============================== */

/**
 * 구분자 자동 판별. 사내에서 오가는 파일은 엑셀에서 "다른 이름으로 저장"한 것이 대부분이라
 * 지역 설정에 따라 쉼표 대신 세미콜론이나 탭이 오는 경우가 실제로 있다.
 */
function detectDelimiter(headerLine) {
  const counts = [
    [',', (headerLine.match(/,/g) || []).length],
    [';', (headerLine.match(/;/g) || []).length],
    ['\t', (headerLine.match(/\t/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC4180 방식 CSV 파서. 따옴표 안의 구분자·줄바꿈을 지킨다. */
export function parseCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  if (!clean.trim()) return { header: [], rows: [] };
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] || '');

  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) table.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) table.push(row);

  if (!table.length) return { header: [], rows: [] };
  const header = table[0].map((x) => x.trim());
  const rows = table.slice(1).map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = (cells[index] ?? '').trim();
    });
    return record;
  });
  return { header, rows };
}

/* ============================== 열 이름 매핑 ============================== */

/** 헤더 비교용 정규화. 대소문자·공백·밑줄·괄호를 무시한다. */
const normalizeHeader = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-()[\]]/g, '');

/**
 * 열 정의. aliases 는 사내 파일에서 실제로 쓰이는 이름들이다.
 * kind: 'text' | 'number' | 'int'
 */
export const PRODUCT_COLUMNS = [
  { key: 'code', label: '제품코드', kind: 'text', required: true, aliases: ['code', 'pcc', '제품코드', '설계코드', '코드'] },
  { key: 'name', label: '제품명', kind: 'text', aliases: ['name', '제품명', '명칭', '품명'] },
  { key: 'group', label: '제품군', kind: 'text', required: true, aliases: ['group', '제품군', '그룹'] },
  { key: 'type', label: '형식', kind: 'text', aliases: ['type', '형식', '타입'] },
  { key: 'c20', label: 'C20', kind: 'number', aliases: ['c20', 'c20용량', '용량'] },
  { key: 'rc', label: 'RC', kind: 'number', aliases: ['rc', '예비용량'] },
  { key: 'encca', label: 'EN CCA', kind: 'number', aliases: ['encca', 'en', 'encca a'] },
  { key: 'saecca', label: 'SAE CCA', kind: 'number', aliases: ['saecca', 'sae'] },
  { key: 'assembly', label: '조립매수', kind: 'int', required: true, aliases: ['assembly', '조립매수', '총매수', '매수'] },
  { key: 'posCode', label: '양극코드', kind: 'text', required: true, aliases: ['poscode', '양극코드', '양극'] },
  { key: 'posQty', label: '양극매수', kind: 'int', aliases: ['posqty', '양극매수', '양극수'] },
  { key: 'negCode', label: '음극코드', kind: 'text', required: true, aliases: ['negcode', '음극코드', '음극'] },
  { key: 'negQty', label: '음극매수', kind: 'int', aliases: ['negqty', '음극매수', '음극수'] },
  { key: 'L', label: '길이', kind: 'number', aliases: ['l', '길이', 'length'] },
  { key: 'W', label: '폭', kind: 'number', aliases: ['w', '폭', 'width'] },
  { key: 'H', label: '높이', kind: 'number', aliases: ['h', '높이', 'height'] },
  { key: 'weight', label: '중량', kind: 'number', aliases: ['weight', '중량'] },
  { key: 'lead', label: '연량', kind: 'number', aliases: ['lead', '연량'] },
  { key: 'observations', label: '실적건수', kind: 'int', aliases: ['observations', '실적건수', '관측수'] },
  { key: 'salesQty', label: '판매수량', kind: 'int', aliases: ['salesqty', '판매수량', '연간판매수량', '수량'] },
];

export const PLATE_COLUMNS = [
  { key: 'code', label: '극판코드', kind: 'text', required: true, aliases: ['code', '극판코드', '코드'] },
  { key: 'name', label: '극판명', kind: 'text', aliases: ['name', '극판명', '명칭', '품명'] },
  { key: 'width', label: '폭', kind: 'number', required: true, aliases: ['width', '폭', '너비'] },
  { key: 'height', label: '높이', kind: 'number', required: true, aliases: ['height', '높이'] },
  { key: 'thickness', label: '두께', kind: 'text', aliases: ['thickness', '두께'] },
  { key: 'baseWeight', label: '기판중량', kind: 'number', aliases: ['baseweight', '기판중량', '기판'] },
  { key: 'activeWeight', label: '활물질', kind: 'number', aliases: ['activeweight', '활물질', '활물질중량'] },
  { key: 'cost', label: '단가', kind: 'number', aliases: ['cost', '단가', '가격'] },
  { key: 'role', label: '역할', kind: 'text', aliases: ['role', '역할', '극성'] },
  {
    key: 'status',
    label: '상태',
    kind: 'text',
    aliases: ['status', '상태', '사용여부', '단종', '사용상태'],
    // 비우면 사용 중. '단종' 등을 적으면 신규 설계 후보에서 빠지되 실적은 근거로 남는다.
  },
];

/**
 * 단종 처리를 삭제가 아니라 상태로 다루는 이유.
 *
 * 극판 마스터에서 한 줄을 빼면 그 극판을 쓰던 실적 제품이 참조를 잃고 통째로 사라진다.
 * (SLI00070 하나를 빼면 제품 11종과 제품군 2개가 증발한다) 예측은 전부 그 실적에서
 * 학습하므로 근거가 같이 무너진다. 그래서 '대체' 모드로 지우지 말고 이 열에 '단종'이라고
 * 적는다 — 병합 모드로 한 줄만 올리면 끝나고, 되돌리는 것도 한 줄이다.
 */
/** 엔진의 parseThickness 와 같은 규칙. 번들이 한 스코프라 이름만 달리 둔다. */
const parseThicknessValue = (text) => {
  const match = String(text ?? '').match(/[0-9]+(?:\.[0-9]+)?/);
  const value = match ? Number(match[0]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
};

const ACTIVE_STATUS_WORDS = new Set(['', 'active', '사용', '사용중', '정상', 'y', 'o']);
export const isActiveStatus = (value) => ACTIVE_STATUS_WORDS.has(String(value ?? '').trim().toLowerCase());

const ROLE_ALIASES = {
  양극: 'positive',
  음극: 'negative',
  공용: 'both',
  미분류: 'unknown',
  positive: 'positive',
  negative: 'negative',
  both: 'both',
  unknown: 'unknown',
};

/** 헤더 → 열 정의 매핑. 같은 열에 여러 후보가 걸리면 앞선 alias 를 쓴다. */
function mapHeaders(header, columns) {
  const seen = new Map();
  header.forEach((raw) => {
    const key = normalizeHeader(raw);
    if (!seen.has(key)) seen.set(key, raw);
  });
  const mapping = new Map();
  for (const column of columns) {
    for (const alias of column.aliases) {
      const raw = seen.get(normalizeHeader(alias));
      if (raw !== undefined && !mapping.has(column.key)) mapping.set(column.key, raw);
    }
  }
  return mapping;
}

/**
 * 파일 종류 자동 판별. 사용자가 "제품" 과 "극판" 을 잘못 고르는 사고를 없앤다.
 * 두께·기판중량은 극판에만, 양극코드·조립매수는 제품에만 있는 열이다.
 */
export function detectKind(header) {
  const keys = new Set(header.map(normalizeHeader));
  const has = (...names) => names.some((n) => keys.has(normalizeHeader(n)));
  const productish = has('poscode', '양극코드', '양극', 'assembly', '조립매수', '총매수');
  // '극판코드' 는 극판 파일에만 있는 이름이다. 단종 표시처럼 두세 열만 올리는 부분 갱신에서는
  // 두께·기판중량이 없을 수 있으므로, 이 이름만으로도 극판 파일로 알아본다.
  const plateish = has('thickness', '두께', 'baseweight', '기판중량', 'activeweight', '활물질', '극판코드');
  if (productish && !plateish) return 'products';
  if (plateish && !productish) return 'plates';
  return null;
}

/* ============================== 값 변환 ============================== */

/** "1,234" · "1 234" · "12.5T" 같은 표기를 숫자로. 빈 칸은 null(=미입력)로 구분한다. */
function toNumber(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text.replace(/,/g, '').replace(/\s/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function readRow(record, columns, mapping) {
  const out = {};
  const errors = [];
  for (const column of columns) {
    const source = mapping.get(column.key);
    const raw = source === undefined ? '' : record[source];
    if (column.kind === 'text') {
      out[column.key] = String(raw ?? '').trim();
      continue;
    }
    const value = toNumber(raw);
    if (Number.isNaN(value)) {
      errors.push(`${column.label} 숫자 아님("${String(raw).slice(0, 20)}")`);
      out[column.key] = null;
    } else {
      out[column.key] = value === null ? null : column.kind === 'int' ? Math.round(value) : value;
    }
  }
  return { value: out, errors };
}

/* ============================== 표 → 레코드 ============================== */

/**
 * 텍스트(CSV/JSON) 한 파일을 읽어 레코드 배열로 만든다.
 * @returns {{kind:'products'|'plates', rows:object[], issues:object[], missingColumns:string[]}}
 */
export function readImportFile(text, filename = '') {
  const isJson = /\.json$/i.test(filename) || /^\s*[[{]/.test(text);
  let records;
  let header;

  if (isJson) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.products || parsed.plates || parsed.rows;
    if (!Array.isArray(list) || !list.length) throw new Error('JSON 안에서 행 목록을 찾지 못했습니다.');
    records = list;
    header = [...new Set(list.flatMap((row) => Object.keys(row)))];
  } else {
    const parsed = parseCsv(text);
    if (!parsed.rows.length) throw new Error('데이터 행이 없습니다. 첫 줄은 열 이름이어야 합니다.');
    records = parsed.rows;
    header = parsed.header;
  }

  const kind = detectKind(header);
  if (!kind) {
    throw new Error(
      '제품 파일인지 극판 파일인지 판별하지 못했습니다. 제품이면 "양극코드·조립매수", 극판이면 "두께·기판중량" 열이 있어야 합니다.',
    );
  }

  const columns = kind === 'products' ? PRODUCT_COLUMNS : PLATE_COLUMNS;
  const mapping = mapHeaders(header, columns);
  /**
   * 극판 파일은 코드만 있으면 받는다.
   *
   * 병합 모드의 요점이 "바뀐 줄만 올린다"인데 치수 열까지 늘 요구하면, 단종 표시 하나·단가
   * 하나를 고치려고 전체 마스터를 다시 만들어야 한다. 그러면 결국 '대체' 모드를 쓰게 되고,
   * 대체는 파일에 없는 항목을 지워 실적을 무너뜨린다(극판 하나 빠지면 그 극판을 쓰던 제품이
   * 통째로 사라진다). 필요 없는 요구가 위험한 길로 떠미는 셈이라 여기서 풀어준다.
   * 값이 정말 모자란지는 기존 DB 와 합쳐본 뒤 행 단위로 판단한다(validateOverlay).
   *
   * 제품 파일은 종전대로 필수 열을 모두 요구한다. 제품은 부분 갱신할 일이 드물고,
   * 열이 통째로 빠진 파일을 행마다 반려하면 같은 오류 수백 건이 쏟아지기 때문이다.
   */
  const requiredHere = kind === 'plates' ? columns.filter((c) => c.key === 'code') : columns.filter((c) => c.required);
  const missingColumns = requiredHere.filter((c) => !mapping.has(c.key)).map((c) => c.label);
  if (missingColumns.length) {
    throw new Error(`필수 열이 없습니다: ${missingColumns.join(', ')}`);
  }

  const rows = [];
  const issues = [];
  records.forEach((record, index) => {
    const { value, errors } = readRow(record, columns, mapping);
    if (errors.length) issues.push({ row: index + 2, code: value.code || '—', message: errors.join(', ') });
    rows.push(value);
  });

  return { kind, rows, issues, missingColumns: [] };
}

/* ============================== 검증 ============================== */

/**
 * 임포트 결과를 내장 DB 와 합친 뒤 정합성을 검사한다.
 * data/build-db.mjs 와 같은 규칙이며, 여기서 걸린 행은 반영하지 않는다.
 *
 * @param {object} base          내장 DB
 * @param {object} staged        { products?: rows[], plates?: rows[] }
 * @param {'merge'|'replace'} mode
 */
export function validateOverlay(base, staged, mode = 'merge') {
  const issues = [];
  // 빈 배열은 "올리지 않음"과 같게 다룬다. 대체 모드에서 빈 파일 하나로 DB가 통째로 비는 사고를 막는다.
  const stagedPlates = staged.plates?.length ? staged.plates : null;
  const stagedProducts = staged.products?.length ? staged.products : null;

  /* ---- 극판 ---- */
  // 내장 DB에 원래 있던 코드. 대체 모드에서도 "새 극판인지" 판단은 이 집합으로 한다.
  const basePlateCodes = new Set(base.plates.map((p) => p.code));
  const plateMap = new Map(mode === 'replace' && stagedPlates ? [] : base.plates.map((p) => [p.code, p]));
  const acceptedPlates = [];
  (stagedPlates || []).forEach((rawRow, index) => {
    const errors = [];
    // 이미 있는 극판이면 빠진 칸은 종전 값을 잇는다. 상태 한 칸만 올려도 통과해야 한다.
    const known = plateMap.get(rawRow.code);
    const row = known
      ? {
          ...rawRow,
          width: rawRow.width ?? known.width,
          height: rawRow.height ?? known.height,
          thickness: rawRow.thickness || known.thickness,
          baseWeight: rawRow.baseWeight ?? known.baseWeight,
          activeWeight: rawRow.activeWeight ?? known.activeWeight,
          cost: rawRow.cost ?? known.cost,
          role: rawRow.role || known.role,
        }
      : rawRow;
    if (!row.code) errors.push('극판 코드 누락');
    if (!(row.width > 0) || !(row.height > 0)) {
      errors.push(known ? '치수 이상' : '치수 이상 — 새 극판은 폭·높이가 필요합니다');
    }
    /**
     * 여기서 막지 않으면 설계 계산이 이 값들 위에 세워진다.
     * 두께는 기판중량·납중량·원가·CCA로, 활물질은 용량으로 곧장 이어지므로
     * "빈칸이라 0" 이 조용히 통과하면 그 뒤 숫자는 전부 그럴듯한 거짓이 된다.
     */
    if (!(parseThicknessValue(row.thickness) > 0)) errors.push('두께 이상 — 예: 0.90T');
    if (!(row.baseWeight > 0)) errors.push('기판중량 이상 — 0보다 커야 합니다');
    if (!(row.activeWeight > 0)) errors.push('활물질중량 이상 — 0보다 커야 합니다');
    if (!(row.cost >= 0)) errors.push('단가 이상 — 0 이상이어야 합니다');
    const normalizedRole = ROLE_ALIASES[String(row.role || '').trim().toLowerCase()];
    /**
     * 극성은 활물질 허용범위(activeWeightRange)를 정하는 데 쓰이므로 새 극판은 반드시 밝혀야 한다.
     *
     * 단, "새 극판인가"는 <b>내장 DB 기준</b>으로 판단한다. 작업 중인 plateMap 으로 보면
     * 대체 모드에서는 지도가 비어 있어 모든 극판이 새것으로 보이고, 내장 DB에 이미 있는
     * 미분류 극판 48종이 통째로 반려된다. 그러면 "현재 극판 내보내기 → 고쳐서 다시 올리기"라는
     * 정상 작업이 그 48종과 그것을 쓰는 제품들을 지워버린다. 막으려던 사고를 막는 코드가
     * 그 사고를 일으키는 셈이라, 판단 기준을 내장 DB 로 둔다.
     */
    const isNewPlate = !basePlateCodes.has(row.code);
    if (isNewPlate && (!normalizedRole || normalizedRole === 'unknown')) {
      errors.push('새 극판은 양극/음극/공용 극성을 지정하세요');
    }
    if (errors.length) {
      issues.push({ kind: 'plates', row: index + 2, code: row.code || '—', message: errors.join(', ') });
      return;
    }
    const previous = plateMap.get(row.code);
    const merged = {
      code: row.code,
      name: row.name || previous?.name || row.code,
      width: row.width,
      height: row.height,
      thickness: row.thickness || previous?.thickness,
      baseWeight: row.baseWeight ?? previous?.baseWeight ?? 0,
      activeWeight: row.activeWeight ?? previous?.activeWeight ?? 0,
      cost: row.cost ?? previous?.cost ?? 0,
      role: ROLE_ALIASES[String(row.role || '').trim().toLowerCase()] || previous?.role || 'unknown',
      /**
       * 상태 열을 비운 채 올리면 종전 상태를 지킨다.
       * 단가만 갱신하려고 올린 파일이 단종 표시를 조용히 지워버리면 안 되기 때문이다.
       * 되살릴 때는 '사용중' 이라고 적어서 올린다.
       */
      status: String(row.status ?? '').trim() || previous?.status || '',
      usage: 0, // 아래에서 제품 참조 수로 다시 센다
    };
    plateMap.set(row.code, merged);
    acceptedPlates.push(merged);
  });

  /* ---- 제품 ---- */
  const productMap = new Map(mode === 'replace' && stagedProducts ? [] : base.products.map((p) => [p.code, p]));
  const acceptedProducts = [];
  const seenInFile = new Set();
  const salesQtyPatch = {};

  (stagedProducts || []).forEach((row, index) => {
    const errors = [];
    if (!row.code) errors.push('제품코드 누락');
    else if (seenInFile.has(row.code)) errors.push('같은 파일 안에서 코드 중복');
    if (!row.group) errors.push('제품군 누락');
    if (!(row.assembly > 0)) errors.push('조립매수 이상');
    if (!row.posCode) errors.push('양극코드 누락');
    else if (!plateMap.has(row.posCode)) errors.push(`양극 ${row.posCode} 미등록 — 극판 파일을 먼저 올리세요`);
    if (!row.negCode) errors.push('음극코드 누락');
    else if (!plateMap.has(row.negCode)) errors.push(`음극 ${row.negCode} 미등록 — 극판 파일을 먼저 올리세요`);
    if (row.posQty !== null && row.posQty !== undefined && !(row.posQty > 0)) errors.push('양극매수 이상');
    if (row.negQty !== null && row.negQty !== undefined && !(row.negQty > 0)) errors.push('음극매수 이상');
    if (row.observations !== null && row.observations !== undefined && row.observations < 0) {
      errors.push('실적건수 음수');
    }
    for (const key of ['c20', 'rc', 'encca', 'saecca']) {
      if (row[key] !== null && row[key] < 0) errors.push(`${key} 음수`);
    }
    if (errors.length) {
      issues.push({ kind: 'products', row: index + 2, code: row.code || '—', message: errors.join(', ') });
      return;
    }
    seenInFile.add(row.code);
    const previous = productMap.get(row.code);
    const merged = {
      code: row.code,
      name: row.name || previous?.name || row.code,
      group: row.group,
      type: row.type || previous?.type || '',
      c20: row.c20 ?? previous?.c20 ?? 0,
      rc: row.rc ?? previous?.rc ?? 0,
      saecca: row.saecca ?? previous?.saecca ?? 0,
      encca: row.encca ?? previous?.encca ?? 0,
      assembly: row.assembly,
      posCode: row.posCode,
      posQty: row.posQty ?? previous?.posQty ?? Math.ceil(row.assembly / 2),
      negCode: row.negCode,
      negQty: row.negQty ?? previous?.negQty ?? Math.floor(row.assembly / 2),
      L: row.L ?? previous?.L ?? 0,
      W: row.W ?? previous?.W ?? 0,
      H: row.H ?? previous?.H ?? 0,
      weight: row.weight ?? previous?.weight ?? 0,
      lead: row.lead ?? previous?.lead ?? 0,
      // 실적건수는 예측 가중치로 쓰인다. 모르면 1(=한 번 만들어봤다)로 두는 것이 가장 보수적이다.
      observations: row.observations ?? previous?.observations ?? 1,
    };
    productMap.set(row.code, merged);
    acceptedProducts.push(merged);
    if (row.salesQty !== null && row.salesQty >= 0) salesQtyPatch[row.code] = row.salesQty;
  });

  return {
    mode,
    plates: acceptedPlates,
    products: acceptedProducts,
    salesQty: salesQtyPatch,
    issues,
    summary: {
      platesRead: (stagedPlates || []).length,
      productsRead: (stagedProducts || []).length,
      platesAccepted: acceptedPlates.length,
      productsAccepted: acceptedProducts.length,
      rejected: issues.length,
      // 단종 표시된 극판이 몇 종인지 알려준다. 실수로 상태를 적었는지 바로 눈치챌 수 있다.
      obsoletePlates: [...plateMap.values()].filter((p) => !isActiveStatus(p.status)).length,
      resultPlates: plateMap.size,
      resultProducts: productMap.size,
    },
  };
}

/* ============================== 병합 ============================== */

/**
 * 내장 DB 위에 오버레이를 덮어 엔진에 넘길 DB 를 만든다. 내장 DB 객체는 건드리지 않는다.
 * 극판 usage(사용 제품 수)는 표시용 파생값이라 여기서 다시 센다.
 */
export function applyOverlay(base, overlay) {
  if (!overlay || (!overlay.products?.length && !overlay.plates?.length)) return base;
  const replace = overlay.mode === 'replace';

  const plateMap = new Map(replace && overlay.plates?.length ? [] : base.plates.map((p) => [p.code, p]));
  for (const plate of overlay.plates || []) plateMap.set(plate.code, plate);

  const productMap = new Map(replace && overlay.products?.length ? [] : base.products.map((p) => [p.code, p]));
  for (const product of overlay.products || []) productMap.set(product.code, product);

  const products = [...productMap.values()];
  const plates = [...plateMap.values()];

  // 참조가 깨진 제품은 엔진의 referencesOf() 가 어차피 걸러내지만, 표시 숫자가 어긋나므로 여기서 뺀다.
  const validProducts = products.filter((p) => plateMap.has(p.posCode) && plateMap.has(p.negCode));

  const usage = new Map();
  for (const product of validProducts) {
    usage.set(product.posCode, (usage.get(product.posCode) || 0) + 1);
    usage.set(product.negCode, (usage.get(product.negCode) || 0) + 1);
  }

  const salesQty = { ...base.salesQty };
  for (const [code, qty] of Object.entries(overlay.salesQty || {})) salesQty[code] = qty;
  // 대체 모드에서는 사라진 제품의 판매수량이 남지 않게 한다.
  const known = new Set(validProducts.map((p) => p.code));
  for (const code of Object.keys(salesQty)) if (!known.has(code)) delete salesQty[code];

  const groupOrder = [...new Set([...(base.groupOrder || []), ...validProducts.map((p) => p.group)])];

  return {
    ...base,
    plates: plates.map((p) => ({ ...p, usage: usage.get(p.code) || 0 })),
    products: validProducts,
    salesQty,
    groupOrder,
    meta: {
      ...base.meta,
      uniqueDesigns: validProducts.length,
      plates: plates.length,
      groups: groupOrder.length,
      sourceBuild: `${base.meta?.sourceBuild || '—'} + 임포트 ${String(overlay.importedAt || '').slice(0, 10)}`,
    },
    overlay: {
      mode: overlay.mode,
      importedAt: overlay.importedAt,
      sources: overlay.sources || [],
      baseProducts: base.products.length,
      basePlates: base.plates.length,
    },
  };
}

/* ============================== 저장 ============================== */

export function loadOverlay() {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== OVERLAY_SCHEMA) return null;
    return parsed;
  } catch (error) {
    console.warn('[dbsource] 임포트 DB 를 읽지 못했습니다', error);
    return null;
  }
}

/** @returns {{ok:true, bytes:number} | {ok:false, message:string}} */
export function saveOverlay(overlay) {
  let payload;
  try {
    payload = JSON.stringify({ ...overlay, schema: OVERLAY_SCHEMA });
  } catch (error) {
    return { ok: false, message: `임포트 DB 를 만들지 못했습니다: ${error.message}` };
  }
  try {
    localStorage.setItem(OVERLAY_KEY, payload);
    return { ok: true, bytes: payload.length };
  } catch (error) {
    const quota =
      error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
    return {
      ok: false,
      message: quota
        ? `브라우저 저장공간(약 5MB)이 부족합니다(${Math.round(payload.length / 1024)}KB). 오래된 과제를 백업 후 지우거나, 꼭 필요한 제품군만 나눠서 올려주세요.`
        : `임포트 DB 를 저장하지 못했습니다: ${error.message}`,
    };
  }
}

export function clearOverlay() {
  try {
    localStorage.removeItem(OVERLAY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function overlayUsage() {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    return raw ? raw.length : 0;
  } catch {
    return 0;
  }
}

/* ============================== 양식·내보내기 ============================== */

const columnsOf = (kind) => (kind === 'plates' ? PLATE_COLUMNS : PRODUCT_COLUMNS);

/** 빈 CSV 양식. 열 이름과 예시 한 줄을 준다. */
export function templateRows(kind) {
  const columns = columnsOf(kind);
  const sample =
    kind === 'plates'
      ? { code: 'SLI09001', name: '예시 극판', width: 143, height: 128, thickness: '0.90T', baseWeight: 42.3, activeWeight: 98, cost: 446.4, role: '양극' }
      : {
          code: 'PCF09001', name: '예시 제품', group: '12M24', type: 'PM', c20: 60, rc: 105, encca: 540, saecca: 570,
          assembly: 13, posCode: 'SLI09001', posQty: 7, negCode: 'SLI09002', negQty: 6,
          L: 242, W: 175, H: 190, weight: 15.2, lead: 8.1, observations: 1, salesQty: 12000,
        };
  return [columns.map((c) => c.label), columns.map((c) => sample[c.key] ?? '')];
}

/** 현재 적용 중인 DB 를 같은 열 이름으로 내보낸다. 고쳐서 다시 올리는 왕복이 가능해진다. */
export function exportRows(db, kind) {
  const columns = columnsOf(kind);
  const source = kind === 'plates' ? db.plates : db.products;
  const salesQty = db.salesQty || {};
  return [
    columns.map((c) => c.label),
    ...source.map((row) => columns.map((c) => (c.key === 'salesQty' ? salesQty[row.code] ?? '' : row[c.key] ?? ''))),
  ];
}
