/**
 * src/core/project.js — 과제와 라인업 데이터 모델.
 *
 * 핵심 규칙: 제품은 uid로 식별하고, 사람이 보는 이름(name)은 표시 전용이다.
 * 구버전은 표시명을 그대로 키로 썼기 때문에 "제품 3"이 두 개 생기면 결과와 근거가 뒤섞였다.
 */
import { DEFAULT_ASSUMPTIONS, DEFAULT_CELL_COUNT } from './engine.js';

export const ENGINE_VERSION = 'v8.0-ported-from-v5.3';

let fallbackCounter = 0;
const newUid = () =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `uid-${Date.now()}-${++fallbackCounter}`;

/** 제품군을 고르면 그 제품군의 학습값을 목표 초기값으로 채운다. */
export function createLineupItem(engine, group, name) {
  const learning = engine.learningByGroup.get(group);
  return {
    uid: newUid(),
    name: name || group,
    group,
    type: engine.technologyOf(group),
    targetC20: learning?.performance.c20.typical || 50,
    targetRc: learning?.performance.rc.typical || 90,
    targetEnCca: learning?.performance.enCca.typical || 500,
    targetSaeCca: learning?.performance.saeCca.typical || 520,
    maxPlates: learning?.assembly.max || 15,
    annualVolume: 30000,
    cellCount: DEFAULT_CELL_COUNT,
    preferredReferenceCode: undefined,
  };
}

export function createProject(engine, startingGroup) {
  const group = startingGroup || engine.groups.find((g) => g.currentProducts > 0)?.group || engine.groups[0].group;
  return {
    id: `project-${newUid()}`,
    name: '새 배터리 라인업',
    customer: '',
    requestNo: '',
    owner: '',
    market: '',
    targetSop: '',
    status: 'draft',
    objective: 'balanced',
    selectedKind: 'hybrid',
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    lineup: [createLineupItem(engine, group, '제품 1')],
    resultSnapshot: null,
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** 저장본·백업본을 현재 스키마로 맞춘다. 구버전 프로젝트도 여기서 흡수한다. */
export function normalizeProject(engine, raw) {
  const lineup = (raw.lineup || []).map((item, index) => {
    const group = engine.learningByGroup.has(item.group) ? item.group : engine.groups[0].group;
    return {
      uid: item.uid || newUid(),
      // 구버전은 id가 곧 표시명이었다.
      name: item.name || item.id || `제품 ${index + 1}`,
      group,
      type: item.type || engine.technologyOf(group),
      targetC20: Number(item.targetC20) || 0,
      targetRc: Number(item.targetRc) || 0,
      targetEnCca: Number(item.targetEnCca) || 0,
      targetSaeCca: Number(item.targetSaeCca) || 0,
      maxPlates: Number(item.maxPlates) || 0,
      annualVolume: Number(item.annualVolume) || 0,
      cellCount: Number(item.cellCount) > 0 ? Number(item.cellCount) : DEFAULT_CELL_COUNT,
      preferredReferenceCode: item.preferredReferenceCode || undefined,
    };
  });
  return {
    ...raw,
    id: raw.id || `project-${newUid()}`,
    name: raw.name || '이름 없는 과제',
    status: raw.status || 'draft',
    objective: raw.objective || 'balanced',
    selectedKind: raw.selectedKind || 'hybrid',
    assumptions: migrateAssumptions(raw.assumptions),
    lineup: lineup.length ? lineup : [createLineupItem(engine, engine.groups[0].group, '제품 1')],
  };
}

/**
 * 구버전 기본 금형비 (극판군당). 사내에는 극판 금형이 확보되어 있어 실제로는 0인데,
 * 이 값이 신형안 대당 원가에 분담금으로 실려 원가 비교를 왜곡하고 있었다.
 */
const LEGACY_TOOLING = { newToolingCost: 26000000, hybridToolingCost: 12000000 };

/**
 * 저장된 과제의 원가 가정을 읽는다.
 *
 * 금형비가 <b>구버전 기본값 그대로</b>인 과제만 0으로 내린다. 손대지 않은 기본값이라는
 * 신호가 분명하기 때문이다. 사용자가 직접 넣은 다른 금액은 실제 투자일 수 있으므로 건드리지 않는다.
 */
function migrateAssumptions(saved) {
  const merged = { ...DEFAULT_ASSUMPTIONS, ...(saved || {}) };
  for (const [key, legacyValue] of Object.entries(LEGACY_TOOLING)) {
    if (merged[key] === legacyValue) merged[key] = DEFAULT_ASSUMPTIONS[key];
  }
  return merged;
}

/** 엔진에 넘길 스펙. 엔진은 uid를 그대로 들고 다니므로 결과와 입력이 항상 짝을 이룬다. */
export const specsOf = (project) =>
  project.lineup.map((item) => ({
    uid: item.uid,
    id: item.name, // 보고서 표기용
    name: item.name,
    group: item.group,
    type: item.type,
    targetC20: item.targetC20,
    targetRc: item.targetRc,
    targetEnCca: item.targetEnCca,
    targetSaeCca: item.targetSaeCca,
    maxPlates: item.maxPlates,
    annualVolume: item.annualVolume,
    cellCount: item.cellCount,
    preferredReferenceCode: item.preferredReferenceCode,
  }));

const TARGET_FIELDS = [
  ['targetC20', 'C20 목표'],
  ['targetRc', 'RC 목표'],
  ['targetEnCca', 'EN CCA 목표'],
  ['targetSaeCca', 'SAE CCA 목표'],
];

/**
 * 계산을 시작해도 되는 입력인지 검사한다.
 * 여기서 막지 않으면 목표 0으로 계산이 돌아 의미 없는 결과가 보고서까지 흘러간다.
 */
export function validateItem(engine, item, allItems) {
  const errors = [];
  const warnings = [];

  if (!String(item.name).trim()) errors.push('제품 이름을 입력하세요.');
  if (allItems.some((other) => other.uid !== item.uid && other.name.trim() === item.name.trim())) {
    warnings.push('같은 이름의 제품이 있습니다. 보고서에서 구분이 어렵습니다.');
  }
  for (const [key, label] of TARGET_FIELDS) {
    if (!(item[key] > 0)) errors.push(`${label}을(를) 입력하세요.`);
  }
  if (!(item.maxPlates > 0)) errors.push('최대 허용매수를 입력하세요.');
  if (!(item.annualVolume > 0)) errors.push('연간 기준수량을 입력하세요.');
  if (!(item.cellCount > 0)) errors.push('셀 수를 입력하세요.');

  const profile = engine.groupProfile(item.group, item.type);
  if (!profile.valid) errors.push(profile.reason);

  const learning = engine.learningByGroup.get(item.group);
  if (learning && item.maxPlates > 0) {
    if (item.maxPlates < learning.assembly.min) {
      warnings.push(`DB 실적 최소매수 ${learning.assembly.min}매보다 상한이 낮습니다. 설계 여지가 없을 수 있습니다.`);
    }
    if (item.maxPlates > learning.assembly.max) {
      warnings.push(`DB 실적 최대매수 ${learning.assembly.max}매를 넘는 상한입니다. 검토 범위는 실적 범위로 제한됩니다.`);
    }
  }
  if (learning?.evidenceGrade === 'D') warnings.push('이 제품군은 근거 실적이 없어 D등급입니다. 승인 근거로 쓸 수 없습니다.');

  return { errors, warnings, ok: errors.length === 0 };
}

export function validateLineup(engine, lineup) {
  const perItem = lineup.map((item) => ({ item, ...validateItem(engine, item, lineup) }));
  return {
    perItem,
    ok: perItem.every((r) => r.ok),
    errorCount: perItem.reduce((sum, r) => sum + r.errors.length, 0),
    warningCount: perItem.reduce((sum, r) => sum + r.warnings.length, 0),
    blockedItems: perItem.filter((r) => !r.ok).map((r) => r.item.name),
  };
}

/** 이름 자동 채번. 이미 쓰는 번호를 피해 다음 번호를 고른다. */
export function nextProductName(lineup) {
  const used = new Set(lineup.map((item) => item.name));
  let index = lineup.length + 1;
  while (used.has(`제품 ${index}`)) index++;
  return `제품 ${index}`;
}

export function duplicateName(lineup, baseName) {
  const used = new Set(lineup.map((item) => item.name));
  let suffix = 2;
  while (used.has(`${baseName}-${suffix}`)) suffix++;
  return `${baseName}-${suffix}`;
}

export const cloneItem = (item, name) => ({ ...item, uid: newUid(), name });
