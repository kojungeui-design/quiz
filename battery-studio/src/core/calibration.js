/**
 * src/core/calibration.js — 시제품 실측으로 예측식을 보정한다.
 *
 * 왜 필요한가: 백테스트(MAPE)는 DB가 자기 자신을 얼마나 재현하는지의 하한선일 뿐, 신제품
 * 정확도의 보증이 아니다. 시제품을 만들어 실측이 나와도 그 값이 예측식으로 되돌아가지 않으면
 * 도구는 아무리 오래 써도 똑똑해지지 않는다. 여기서 그 고리를 닫는다.
 *
 * 보정식은 지표별 1차식이다:  실측 = intercept + slope × 예측
 * 엔진은 승인된 보정식만 예측값에 적용한다(createEngine 의 options.calibration).
 *
 * 잘못된 보정은 모든 예측을 조용히 망가뜨린다. 그래서 이 파일의 대부분은 "언제 보정을
 * 쓰면 안 되는가"에 대한 것이다.
 *   · 표본이 적으면(5건 미만) 적합하지 않는다 — 2개 계수를 뽑기에 모자란다.
 *   · 기울기가 상식 범위(0.5~1.5)를 벗어나면 승인할 수 없다 — 데이터가 섞였다는 신호다.
 *   · 보정이 무보정보다 오차가 크면 승인할 수 없다 — 고쳐서 더 나빠지는 보정은 보정이 아니다.
 *   · 승인 전에는 어떤 경우에도 예측에 반영하지 않는다.
 */
import { parseCsv } from './dbsource.js';

const CALIBRATION_KEY = 'bds-v8-calibration-v1';
const CALIBRATION_SCHEMA = 'bds-calibration-v1';

/** 최소 표본 수. 1차식 계수 2개를 뽑는 데 3건은 너무 적다(구버전은 3건이었다). */
export const MIN_CALIBRATION_SAMPLES = 5;
const SLOPE_MIN = 0.5;
const SLOPE_MAX = 1.5;

export const CALIBRATION_METRICS = [
  { key: 'c20', label: 'C20 용량', unit: 'Ah', digits: 1 },
  { key: 'rc', label: 'RC', unit: '분', digits: 0 },
  { key: 'encca', label: 'EN CCA', unit: 'A', digits: 0 },
  { key: 'saecca', label: 'SAE CCA', unit: 'A', digits: 0 },
];

const CALIB_METRIC_KEYS = CALIBRATION_METRICS.map((m) => m.key);
export const isCalibrationMetric = (key) => CALIB_METRIC_KEYS.includes(key);

export const emptyCalibration = () => ({
  schema: CALIBRATION_SCHEMA,
  metrics: Object.fromEntries(CALIB_METRIC_KEYS.map((key) => [key, { samples: [], approved: false }])),
});

/* ============================== 적합 ============================== */

/**
 * 최소제곱 1차 적합. 무보정(y = x)과 견줘 실제로 나아지는지까지 함께 계산한다.
 *
 * @param {{predicted:number, observed:number}[]} samples
 * @returns {null | object} 표본이 모자라면 null
 */
export function fitCalibration(samples) {
  const points = (samples || []).filter(
    (s) => Number.isFinite(s.predicted) && Number.isFinite(s.observed) && s.predicted > 0 && s.observed > 0,
  );
  const n = points.length;
  if (n < MIN_CALIBRATION_SAMPLES) return null;

  const meanX = points.reduce((sum, p) => sum + p.predicted, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.observed, 0) / n;
  const varianceX = points.reduce((sum, p) => sum + (p.predicted - meanX) ** 2, 0);

  // 예측값이 전부 같으면 기울기를 정할 수 없다. 절편만 옮기는 보정으로 물러선다.
  const slope = varianceX > 1e-9 ? points.reduce((sum, p) => sum + (p.predicted - meanX) * (p.observed - meanY), 0) / varianceX : 1;
  const intercept = meanY - slope * meanX;

  const errorsOf = (predict) => points.map((p) => p.observed - predict(p.predicted));
  const rmseOf = (errors) => Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / n);
  const mapeOf = (errors) => (errors.reduce((sum, e, i) => sum + Math.abs(e / points[i].observed), 0) / n) * 100;

  const fitted = errorsOf((x) => intercept + slope * x);
  const baseline = errorsOf((x) => x); // 보정하지 않았을 때
  const totalVariance = points.reduce((sum, p) => sum + (p.observed - meanY) ** 2, 0);
  const residual = fitted.reduce((sum, e) => sum + e * e, 0);

  const predictedValues = points.map((p) => p.predicted);

  return {
    n,
    slope,
    intercept,
    r2: totalVariance > 1e-9 ? 1 - residual / totalVariance : 0,
    rmse: rmseOf(fitted),
    mape: mapeOf(fitted),
    baselineRmse: rmseOf(baseline),
    baselineMape: mapeOf(baseline),
    // 평균적으로 예측이 몇 % 높거나 낮았는지. 기울기·절편보다 사람이 읽기 쉽다.
    meanBias: (points.reduce((sum, p) => sum + (p.predicted - p.observed) / p.observed, 0) / n) * 100,
    range: [Math.min(...predictedValues), Math.max(...predictedValues)],
    excluded: (samples || []).length - n,
  };
}

/**
 * 승인해도 되는 적합인지 판정한다. 사유는 화면에 그대로 보여주기 위한 문장이다.
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function calibrationEligibility(fit) {
  if (!fit) return { ok: false, reasons: [`표본이 ${MIN_CALIBRATION_SAMPLES}건 이상이어야 합니다.`] };
  const reasons = [];
  if (fit.slope < SLOPE_MIN || fit.slope > SLOPE_MAX) {
    reasons.push(
      `기울기 ${fit.slope.toFixed(3)} 가 상식 범위(${SLOPE_MIN}~${SLOPE_MAX})를 벗어났습니다. 다른 지표나 다른 시험조건의 값이 섞였는지 확인하세요.`,
    );
  }
  if (fit.rmse >= fit.baselineRmse) {
    reasons.push('보정해도 오차가 줄지 않습니다(무보정 대비). 이 보정은 쓸 이유가 없습니다.');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * 지금 예측에 실제로 적용할 보정식만 추린다. 승인 + 적합 조건을 모두 만족해야 한다.
 * @returns {null | Record<string, {slope:number, intercept:number}>}
 */
export function activeCalibrationModels(calibration) {
  if (!calibration?.metrics) return null;
  const active = {};
  for (const key of CALIB_METRIC_KEYS) {
    const entry = calibration.metrics[key];
    if (!entry?.approved) continue;
    const fit = fitCalibration(entry.samples);
    if (!calibrationEligibility(fit).ok) continue;
    active[key] = { slope: fit.slope, intercept: fit.intercept };
  }
  return Object.keys(active).length ? active : null;
}

/** 화면 표시용 요약. 승인 여부와 무관하게 지표별 현재 상태를 돌려준다. */
export function calibrationSummary(calibration) {
  return CALIBRATION_METRICS.map((metric) => {
    const entry = calibration?.metrics?.[metric.key] || { samples: [], approved: false };
    const fit = fitCalibration(entry.samples);
    const eligibility = calibrationEligibility(fit);
    return {
      ...metric,
      samples: entry.samples || [],
      approved: !!entry.approved,
      approvedAt: entry.approvedAt || null,
      fit,
      eligibility,
      active: !!entry.approved && eligibility.ok,
    };
  });
}

/* ============================== 표본 다루기 ============================== */

let sampleCounter = 0;
const newSampleId = () =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `cal-${Date.now()}-${++sampleCounter}`;

/**
 * 표본을 더한다. 표본이 바뀌면 승인은 자동으로 풀린다 —
 * 승인한 사람이 본 데이터와 지금 적용되는 데이터가 달라지면 안 되기 때문이다.
 */
export function addCalibrationSamples(calibration, metric, rows) {
  if (!isCalibrationMetric(metric)) throw new Error(`알 수 없는 지표: ${metric}`);
  const base = calibration || emptyCalibration();
  const entry = base.metrics[metric] || { samples: [], approved: false };
  const added = rows.map((row) => ({
    id: newSampleId(),
    product: String(row.product || '').trim() || '이름 없음',
    group: String(row.group || '').trim(),
    predicted: Number(row.predicted),
    observed: Number(row.observed),
    note: String(row.note || '').trim(),
    testedAt: row.testedAt || new Date().toISOString(),
  }));
  return {
    ...base,
    metrics: {
      ...base.metrics,
      [metric]: { samples: [...entry.samples, ...added], approved: false, approvedAt: null },
    },
  };
}

export function removeCalibrationSample(calibration, metric, id) {
  const entry = calibration.metrics[metric];
  return {
    ...calibration,
    metrics: {
      ...calibration.metrics,
      [metric]: { samples: entry.samples.filter((s) => s.id !== id), approved: false, approvedAt: null },
    },
  };
}

/** 승인/승인 해제. 조건을 만족하지 않으면 승인되지 않는다. */
export function setCalibrationApproval(calibration, metric, approved) {
  const entry = calibration.metrics[metric];
  if (approved) {
    const eligibility = calibrationEligibility(fitCalibration(entry.samples));
    if (!eligibility.ok) return { ok: false, message: eligibility.reasons.join(' ') };
  }
  return {
    ok: true,
    calibration: {
      ...calibration,
      metrics: {
        ...calibration.metrics,
        [metric]: { ...entry, approved, approvedAt: approved ? new Date().toISOString() : null },
      },
    },
  };
}

/* ============================== CSV 등록 ============================== */

const METRIC_ALIASES = {
  c20: 'c20', C20: 'c20', 용량: 'c20',
  rc: 'rc', RC: 'rc', 예비용량: 'rc',
  encca: 'encca', ENCCA: 'encca', 'EN CCA': 'encca', EN: 'encca',
  saecca: 'saecca', SAECCA: 'saecca', 'SAE CCA': 'saecca', SAE: 'saecca',
};

const pickColumn = (row, names) => {
  const key = Object.keys(row).find((k) => names.some((n) => k.replace(/[\s_]/g, '').toLowerCase() === n.replace(/[\s_]/g, '').toLowerCase()));
  return key === undefined ? '' : row[key];
};

/**
 * 예측·실측 쌍 CSV를 읽는다. 지표 열이 있으면 한 파일에 여러 지표를 섞어 올릴 수 있다.
 * @returns {{rows:object[], issues:object[]}}
 */
export function parseCalibrationCsv(text, defaultMetric) {
  const { rows } = parseCsv(text);
  if (!rows.length) throw new Error('데이터 행이 없습니다. 첫 줄은 열 이름이어야 합니다.');

  const parsed = [];
  const issues = [];
  rows.forEach((row, index) => {
    const rawMetric = String(pickColumn(row, ['지표', 'metric', '항목'])).trim();
    const metric = rawMetric ? METRIC_ALIASES[rawMetric] || METRIC_ALIASES[rawMetric.toUpperCase()] : defaultMetric;
    const predicted = Number(String(pickColumn(row, ['예측', 'predicted', '예측값'])).replace(/,/g, ''));
    const observed = Number(String(pickColumn(row, ['실측', 'observed', '실측값'])).replace(/,/g, ''));
    const product = pickColumn(row, ['제품', 'product', '제품명', '시제품']);
    const group = pickColumn(row, ['제품군', 'group']);
    const note = pickColumn(row, ['비고', 'note', '시험조건']);

    const errors = [];
    if (!metric) errors.push('지표를 알 수 없습니다(C20/RC/EN CCA/SAE CCA)');
    if (!Number.isFinite(predicted) || predicted <= 0) errors.push('예측값이 숫자가 아닙니다');
    if (!Number.isFinite(observed) || observed <= 0) errors.push('실측값이 숫자가 아닙니다');
    if (errors.length) {
      issues.push({ row: index + 2, product: String(product || '—'), message: errors.join(', ') });
      return;
    }
    parsed.push({ metric, predicted, observed, product, group, note });
  });
  return { rows: parsed, issues };
}

export const calibrationTemplateRows = () => [
  ['지표', '제품', '제품군', '예측', '실측', '비고'],
  ['EN CCA', '시제품 A', '12M24', 540, 512, '-18℃ 1차'],
  ['C20', '시제품 A', '12M24', 60, 58.4, ''],
];

/* ============================== 저장 ============================== */

export function loadCalibration() {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== CALIBRATION_SCHEMA) return null;
    return parsed;
  } catch (error) {
    console.warn('[calibration] 보정 데이터를 읽지 못했습니다', error);
    return null;
  }
}

/** @returns {{ok:true} | {ok:false, message:string}} */
export function saveCalibration(calibration) {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ ...calibration, schema: CALIBRATION_SCHEMA }));
    return { ok: true };
  } catch (error) {
    const quota =
      error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
    return {
      ok: false,
      message: quota
        ? '브라우저 저장공간이 부족합니다. 오래된 과제를 백업 후 지우고 다시 시도하세요.'
        : `보정 데이터를 저장하지 못했습니다: ${error.message}`,
    };
  }
}

export function calibrationBackupRows(calibration) {
  const rows = [['지표', '제품', '제품군', '예측', '실측', '비고', '시험일시']];
  for (const metric of CALIBRATION_METRICS) {
    for (const sample of calibration?.metrics?.[metric.key]?.samples || []) {
      rows.push([metric.label, sample.product, sample.group, sample.predicted, sample.observed, sample.note, sample.testedAt]);
    }
  }
  return rows;
}
