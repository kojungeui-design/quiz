/**
 * src/core/format.js — 화면 표기 규칙을 한 곳에 모은다.
 * 같은 값이 화면마다 다른 자릿수로 보이는 일을 막기 위한 파일이다.
 */

const KO = 'ko-KR';

export const num = (value, digits = 0) =>
  Number.isFinite(value) ? value.toLocaleString(KO, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

export const won = (value) => (Number.isFinite(value) ? `${Math.round(value).toLocaleString(KO)}원` : '—');

export const manwon = (value) =>
  Number.isFinite(value) ? `${(value / 10000).toLocaleString(KO, { maximumFractionDigits: 0 })}만원` : '—';

export const eok = (value) =>
  Number.isFinite(value) ? `${(value / 100000000).toLocaleString(KO, { maximumFractionDigits: 1 })}억원` : '—';

export const pct = (value, digits = 0) => (Number.isFinite(value) ? `${num(value, digits)}%` : '—');

/**
 * 성능여유 표기. 목표가 없어 계산이 불가능하면 '목표 미입력'으로 분명히 밝힌다.
 * 구버전은 이 경우 Infinity%를 그대로 찍었다.
 */
export function margin(value) {
  if (value === null || value === undefined) return '목표 미입력';
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${num(value, 1)}%`;
}

export const marginClass = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unknown';
  if (value < 0) return 'fail';
  if (value < 5) return 'tight';
  return 'pass';
};

/** 설계안이 4개 목표를 모두 충족했는지. 목표 미입력(null)은 충족으로 치지 않는다. */
export const MARGIN_KEYS = ['c20Margin', 'rcMargin', 'ccaMargin', 'saeMargin'];
export const meetsAllTargets = (design) =>
  design.compatibility.valid && !design.warning && MARGIN_KEYS.every((key) => Number.isFinite(design[key]) && design[key] >= 0);

export const dateLabel = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const STATUS_LABEL = {
  draft: '요구사양 작성',
  design: '설계 검토',
  review: '검토 요청',
  approved: '승인',
};

export const OBJECTIVE_LABEL = {
  balanced: '균형',
  cost: '원가 우선',
  performance: '성능 우선',
};

export const GRADE_NOTE = {
  A: '실적 3건 이상·관측 20건 이상. 승인 근거로 쓸 수 있습니다.',
  B: '실적 2건 이상. 검토 근거로 쓸 수 있습니다.',
  C: '실적 1건. 참고용이며 시험 검증이 필요합니다.',
  D: '근거 실적이 없습니다. 승인 근거로 사용할 수 없습니다.',
};
