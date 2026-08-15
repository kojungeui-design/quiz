/**
 * src/core/engine.js — 배터리 설계 계산 엔진
 *
 * 구버전(v5.3-existing-match) 번들에서 이식했습니다. 계산 결과의 연속성을 위해
 * 수식과 상수는 그대로 옮겼고, 아래 "이식 시 수정한 것" 항목만 동작이 달라집니다.
 * 구엔진과의 수치 일치는 test/parity.test.mjs 가 740개 제품 전수로 검증합니다.
 *
 * 이식 시 수정한 것
 *   1. 목표 성능이 0 이하이면 마진을 null로 반환한다. (구버전은 0으로 나눠 Infinity/NaN을 출력)
 *   2. 공용 극판군이 0개일 때 공용화율을 0%로 반환한다. (구버전은 100%를 넘겼다)
 *   3. 셀 수를 스펙 입력값으로 뺐다. (구버전은 12V 6셀을 상수로 박아두어 6V·24V 원가가 틀렸다)
 *   4. 제품 식별을 표시명이 아닌 uid로 한다. (구버전은 표시명이 중복되면 근거가 뒤섞였다)
 *
 * DOM에 의존하지 않습니다. 브라우저와 node 양쪽에서 동일하게 돌아갑니다.
 */

/* ============================== 공용 수치 유틸 ============================== */

/** 소수 자릿수 반올림. 구엔진의 W(). */
export const round = (value, digits = 0) => Number(value.toFixed(digits));

/** 하한·상한 사이로 자르기. 구엔진의 Ts(). */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 가중 중앙값. 구엔진의 Gs().
 * 평균이 아니라 중앙값을 쓰는 이유: 소량 생산 특이 제품이 제품군 대표값을 끌고 가지 않도록.
 * 가중치는 판매수량이므로 "실제로 많이 파는 제품 쪽"으로 대표값이 이동합니다.
 */
export function weightedMedian(items) {
  const valid = items
    .filter((x) => Number.isFinite(x.value) && x.value > 0 && x.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!valid.length) return 0;
  const half = valid.reduce((sum, x) => sum + x.weight, 0) / 2;
  let cumulative = 0;
  for (const item of valid) {
    cumulative += item.weight;
    if (cumulative >= half) return item.value;
  }
  return valid[valid.length - 1].value;
}

/** "0.90T" → 0.90. 파싱 실패 시 0.7. 구엔진의 F2(). */
export const parseThickness = (text) => Number.parseFloat(String(text).replace(/[^0-9.]/g, '')) || 0.7;

/** 목표가 0 이하이면 마진을 계산하지 않는다. (수정 1) */
export function marginPct(actual, target) {
  if (!(target > 0)) return null;
  return round((actual / target - 1) * 100, 1);
}

const METRIC_KEYS = ['c20', 'rc', 'encca', 'saecca'];
const DEFAULT_CELL_COUNT = 6; // 12V 납축 기준. 스펙에서 덮어쓸 수 있다.

/**
 * 극판단가 회귀계수 (원/g). 극판 마스터 120종 회귀: 단가 ≈ 4.73×기판중량 + 2.39×활물질중량, R² 0.973.
 * 신형 극판 단가를 "기판비 몇 %"라는 고정 가정 대신, 극판마다 실제 비중으로 나누는 데 쓴다.
 * (이식 시 수정 5 — 구엔진의 55/45 고정 분할은 실데이터 평균 40.7%와 어긋나 신형안 원가가 싸게 나왔다)
 */
const PLATE_COST_PER_GRID_G = 4.73;
const PLATE_COST_PER_ACTIVE_G = 2.39;

/**
 * 납중량 모델 계수. 실측 납중량이 있는 제품 735건으로 적합 (MAPE 3.9% · P90 8.3%).
 *   납중량(kg) = 기판납 + 활물질납 + COS납(스트랩·포스트)
 *   활물질납 = 활물질중량 / 1.04 / (양극 1.195 | 음극 1.175)   ← 페이스트→납 환산, 사내 관례 상수
 *   COS납   = max(0, −0.3863×(셀수/6) + 0.6081×기판납)        ← 잔차 회귀. 6셀 실측으로 적합했으므로 셀수 비례 보정.
 */
const LEAD_ACTIVE_DIVISOR_POS = 1.04 * 1.195;
const LEAD_ACTIVE_DIVISOR_NEG = 1.04 * 1.175;
const LEAD_COS_INTERCEPT = -0.3863;
const LEAD_COS_PER_GRID_KG = 0.6081;

/* ============================== 엔진 생성 ============================== */

/**
 * @param {object} db  window.BDS_DB 또는 동일 구조의 객체
 *                     { plates, products, salesQty, groupOrder, meta }
 * @param {object} [options]
 * @param {object} [options.calibration]  지표별 보정식 { c20?: {slope, intercept}, rc?, encca?, saecca? }
 *   시제품 실측으로 얻은 1차식이며, 예측값에만 적용한다(등록 제품의 실측값에는 적용하지 않는다).
 *   넘기지 않으면 보정 없이 동작한다 — 그때의 수치는 구엔진과 완전히 같아야 하며 parity.test 가 그것을 지킨다.
 */
export function createEngine(db, options = {}) {
  const plates = db.plates;
  const products = db.products;
  const salesQty = db.salesQty || {};
  const plateByCode = new Map(plates.map((p) => [p.code, p]));

  const calibration = options.calibration || null;

  /** 예측값 → 보정값. 보정식이 없으면 그대로 돌려준다. */
  const calibrate = (metric, value) => {
    const model = calibration?.[metric];
    if (!model || !(value > 0)) return value;
    return Math.max(0, model.intercept + model.slope * value);
  };

  /**
   * 목표값 → 보정 전 기준 목표. 활물질 역산이 보정 후 결과와 어긋나지 않게 하려면
   * 목표를 먼저 보정 이전 축으로 되돌려 놓고 역산해야 한다.
   */
  const uncalibrate = (metric, target) => {
    const model = calibration?.[metric];
    if (!model || !(model.slope > 0)) return target;
    return Math.max(0, (target - model.intercept) / model.slope);
  };

  const soldQty = (code) => salesQty[code] || 0;
  const sizeKey = (plate) => `${plate.width}×${plate.height}`;
  const platesOf = (product) => ({
    pos: plateByCode.get(product.posCode),
    neg: plateByCode.get(product.negCode),
  });
  /** 양·음극 크기 조합 키. 코드는 달라도 크기가 같으면 같은 근거로 본다. */
  const sizePairKey = (product) => {
    const { pos, neg } = platesOf(product);
    return pos && neg ? `${sizeKey(pos)}|${sizeKey(neg)}` : '';
  };

  /** 제품군명으로 기술 판정. 구엔진의 vn(). */
  const technologyOf = (group) => {
    const upper = String(group).toUpperCase();
    if (upper.includes('AGM')) return 'AGM';
    if (upper.includes('EFB')) return 'EFB';
    return 'PA';
  };

  /** 해당 제품군에서 극판 BOM이 온전한 실적 제품만. 구엔진의 Es(). */
  const referencesOf = (group) =>
    products.filter(
      (p) => p.group === group && p.assembly > 0 && plateByCode.has(p.posCode) && plateByCode.has(p.negCode),
    );

  /** 제품군 안에서 실제로 쓰인 극판 크기 목록. 구엔진의 R2(). */
  function sizesUsedIn(refs, role) {
    const bySize = new Map();
    refs.forEach((ref) => {
      const code = role === 'positive' ? ref.posCode : ref.negCode;
      const plate = plateByCode.get(code);
      if (!plate) return;
      const key = sizeKey(plate);
      const entry = bySize.get(key) || { width: plate.width, height: plate.height, codes: new Set(), observations: 0 };
      entry.codes.add(code);
      entry.observations += ref.observations;
      bySize.set(key, entry);
    });
    return [...bySize.entries()]
      .map(([key, entry]) => ({ ...entry, key, codes: [...entry.codes].sort() }))
      .sort((a, b) => b.observations - a.observations);
  }

  /**
   * 제품군 호환성 프로필. 구엔진의 fl().
   * 이 제품군에서 "허용되는" 극판 코드·크기를 확정한다. 설계는 이 울타리를 벗어나지 않는다.
   */
  const profileCache = new Map();
  function groupProfile(group, declaredType) {
    const cacheKey = `${group}\u0000${declaredType ?? ''}`;
    const cached = profileCache.get(cacheKey);
    if (cached) return cached;

    const technology = technologyOf(group);
    const refs = referencesOf(group);
    const selling = refs.filter((r) => soldQty(r.code) > 0);

    const pairs = new Map();
    refs.forEach((ref) => {
      const { pos, neg } = platesOf(ref);
      if (!pos || !neg) return;
      const key = `${ref.posCode}|${ref.negCode}`;
      const prev = pairs.get(key);
      pairs.set(key, {
        key,
        posCode: ref.posCode,
        negCode: ref.negCode,
        posSize: sizeKey(pos),
        negSize: sizeKey(neg),
        observations: (prev?.observations || 0) + ref.observations,
      });
    });

    const reason =
      declaredType !== undefined && declaredType !== technology
        ? `${group} 제품군은 ${technology} 기술로 분류됩니다.`
        : refs.length === 0
          ? `${group} 제품군에 등록된 극판 조합이 없습니다.`
          : null;

    const result = {
      group,
      technology,
      valid: !reason,
      reason,
      references: refs.length,
      observations: refs.reduce((sum, r) => sum + r.observations, 0),
      currentProducts: selling.length,
      currentSalesQty: selling.reduce((sum, r) => sum + soldQty(r.code), 0),
      currentPositiveCodes: [...new Set(selling.map((r) => r.posCode))].sort(),
      currentNegativeCodes: [...new Set(selling.map((r) => r.negCode))].sort(),
      positiveCodes: [...new Set(refs.map((r) => r.posCode))].sort(),
      negativeCodes: [...new Set(refs.map((r) => r.negCode))].sort(),
      positiveSizes: sizesUsedIn(refs, 'positive'),
      negativeSizes: sizesUsedIn(refs, 'negative'),
      pairs: [...pairs.values()].sort((a, b) => b.observations - a.observations),
    };
    profileCache.set(cacheKey, result);
    return result;
  }

  const groups = [...new Set(products.map((p) => p.group))]
    .sort((a, b) => a.localeCompare(b))
    .map((g) => groupProfile(g));

  /* ---------- 제품군 학습값 ---------- */

  /** 성능 지표 하나에 대한 제품군 대표값. 구엔진의 hn(). */
  function metricSummary(refs, metric) {
    const values = refs.map((r) => r[metric]).filter((v) => v > 0);
    const typical = weightedMedian(refs.map((r) => ({ value: r[metric], weight: soldQty(r.code) || 1 })));
    const perPlate = weightedMedian(
      refs.map((r) => ({ value: r[metric] / Math.max(1, r.assembly), weight: soldQty(r.code) || 1 })),
    );
    return {
      min: values.length ? Math.min(...values) : 0,
      typical: round(typical, metric === 'c20' ? 1 : 0),
      max: values.length ? Math.max(...values) : 0,
      perPlate: round(perPlate, 2),
    };
  }

  /**
   * 근거등급. 구엔진의 z2().
   * A: 4개 지표가 온전한 제품 3건 이상 + 관측 20건 이상 / D: 근거로 쓸 수 없음
   */
  function evidenceGrade(refs) {
    const observations = refs.reduce((sum, r) => sum + r.observations, 0);
    const complete = refs.filter((r) => METRIC_KEYS.every((k) => r[k] > 0)).length;
    if (complete >= 3 && observations >= 20) return 'A';
    if (complete >= 2 && observations >= 5) return 'B';
    if (complete >= 1) return 'C';
    return 'D';
  }

  const groupLearning = groups.map((profile) => {
    const refs = referencesOf(profile.group);
    const selling = refs.filter((r) => soldQty(r.code) > 0);
    // 판매 중인 제품이 있으면 그것만 학습한다. 없으면 등록 실적 전체로 물러선다.
    const learnFrom = selling.length ? selling : refs;

    const designs = new Map();
    learnFrom.forEach((ref) => {
      const { pos, neg } = platesOf(ref);
      if (!pos || !neg) return;
      const key = `${ref.posCode}|${ref.negCode}`;
      const entry = designs.get(key) || {
        posCode: ref.posCode,
        negCode: ref.negCode,
        posSize: sizeKey(pos),
        negSize: sizeKey(neg),
        products: 0,
        salesQty: 0,
        assemblies: [],
      };
      entry.products += 1;
      entry.salesQty += soldQty(ref.code);
      entry.assemblies.push(ref.assembly);
      designs.set(key, entry);
    });

    const assemblies = learnFrom.map((r) => r.assembly).filter((v) => v > 0);
    return {
      group: profile.group,
      technology: profile.technology,
      currentProducts: selling.length,
      currentSalesQty: selling.reduce((sum, r) => sum + soldQty(r.code), 0),
      assembly: {
        min: assemblies.length ? Math.min(...assemblies) : 0,
        typical: round(weightedMedian(learnFrom.map((r) => ({ value: r.assembly, weight: soldQty(r.code) || 1 }))), 0),
        max: assemblies.length ? Math.max(...assemblies) : 0,
      },
      performance: {
        c20: metricSummary(learnFrom, 'c20'),
        rc: metricSummary(learnFrom, 'rc'),
        enCca: metricSummary(learnFrom, 'encca'),
        saeCca: metricSummary(learnFrom, 'saecca'),
      },
      topDesigns: [...designs.values()]
        .sort((a, b) => b.salesQty - a.salesQty || b.products - a.products)
        .slice(0, 3)
        .map((d) => ({ ...d, assembly: `${Math.min(...d.assemblies)}–${Math.max(...d.assemblies)}매` })),
      learningBasis: selling.length ? '현재 판매' : '등록 실적',
      observedPlateCounts: [...new Set(assemblies)].sort((a, b) => a - b),
      evidenceGrade: evidenceGrade(learnFrom),
      metricCoverage: {
        c20: learnFrom.filter((r) => r.c20 > 0).length,
        rc: learnFrom.filter((r) => r.rc > 0).length,
        enCca: learnFrom.filter((r) => r.encca > 0).length,
        saeCca: learnFrom.filter((r) => r.saecca > 0).length,
      },
    };
  });
  const learningByGroup = new Map(groupLearning.map((g) => [g.group, g]));

  /* ---------- 기존 제품 매칭 ---------- */

  /** 스펙이 유효한 제품군을 가리킬 때만 후보를 연다. 구엔진의 Bi(). */
  const candidatesFor = (spec) => (groupProfile(spec.group, spec.type).valid ? referencesOf(spec.group) : []);

  /** 목표와의 거리. 동점 후보를 가를 때만 쓴다. 구엔진의 k2(). */
  function targetDistance(spec, ref) {
    return (
      Math.abs(ref.c20 - spec.targetC20) / Math.max(20, spec.targetC20) +
      Math.abs(ref.encca - spec.targetEnCca) / Math.max(200, spec.targetEnCca) +
      Math.abs(ref.saecca - spec.targetSaeCca) / Math.max(200, spec.targetSaeCca) +
      Math.abs(ref.rc - spec.targetRc) / Math.max(40, spec.targetRc) +
      (ref.assembly > spec.maxPlates ? 2 : 0)
    );
  }

  /**
   * 목표를 그대로 만족하는 기존 PCC 후보. 구엔진의 Bn().
   * directFit = 4개 성능 모두 충족 + 매수 상한 이내.
   */
  function matchExisting(spec, limit = 3) {
    const targets = [
      ['C20', 'c20', spec.targetC20],
      ['RC', 'rc', spec.targetRc],
      ['EN CCA', 'encca', spec.targetEnCca],
      ['SAE CCA', 'saecca', spec.targetSaeCca],
    ];
    return referencesOf(spec.group)
      .map((ref) => {
        const missingMetrics = targets.filter(([, key]) => ref[key] <= 0).map(([label]) => label);
        const margins = {
          c20: marginPct(ref.c20, spec.targetC20),
          rc: marginPct(ref.rc, spec.targetRc),
          enCca: marginPct(ref.encca, spec.targetEnCca),
          saeCca: marginPct(ref.saecca, spec.targetSaeCca),
          assembly: spec.maxPlates - ref.assembly,
        };
        const directFit =
          missingMetrics.length === 0 &&
          ref.c20 >= spec.targetC20 &&
          ref.rc >= spec.targetRc &&
          ref.encca >= spec.targetEnCca &&
          ref.saecca >= spec.targetSaeCca &&
          ref.assembly <= spec.maxPlates;

        // 부족분(shortfall)이 1순위, 목표와의 절대거리가 2순위.
        const shortfall =
          targets.reduce((sum, [, key, target]) => {
            const value = ref[key];
            return sum + (value > 0 ? Math.max(0, target - value) / Math.max(1, target) : 2);
          }, 0) + Math.max(0, ref.assembly - spec.maxPlates) / Math.max(1, spec.maxPlates);
        const distance =
          targets.reduce((sum, [, key, target]) => {
            const value = ref[key];
            return sum + (value > 0 ? Math.abs(value - target) / Math.max(1, target) : 2);
          }, 0) + Math.abs(ref.assembly - spec.maxPlates) / Math.max(1, spec.maxPlates);

        return { reference: ref, directFit, score: round(shortfall * 1000 + distance * 10, 2), missingMetrics, margins };
      })
      .sort(
        (a, b) =>
          (a.directFit !== b.directFit ? (a.directFit ? -1 : 1) : 0) ||
          a.score - b.score ||
          b.reference.observations - a.reference.observations ||
          soldQty(b.reference.code) - soldQty(a.reference.code),
      )
      .slice(0, Math.max(1, limit));
  }

  /* ---------- 설계안 3종 ---------- */

  /**
   * 극판군 키. 이 키가 같은 제품끼리만 공용화된다. 구엔진의 rl().
   *   new    양·음극 모두 신형 → 크기만 같으면 공용
   *   hybrid 신형 양극 + 기존 음극 코드
   *   existing 기존 양·음극 코드 그대로
   */
  function familyKeyOf(ref, kind) {
    const { pos, neg } = platesOf(ref);
    if (!pos || !neg) return '';
    if (kind === 'new') return `NEW:${sizeKey(pos)}|${sizeKey(neg)}`;
    if (kind === 'hybrid') return `HYB:${sizeKey(pos)}|${ref.negCode}`;
    return `EX:${ref.posCode}|${ref.negCode}`;
  }

  /**
   * 라인업 전체에 기준품을 배정한다. 구엔진의 rm().
   * 그리디 집합피복: 가장 많은 제품을 한 극판군으로 덮는 후보부터 고른다.
   * 동점이면 판매수량 → 관측건수 순.
   */
  function assignReferences(specs, kind) {
    const candidates = specs.map((spec) => candidatesFor(spec));
    const coverage = new Map(); // familyKey → Set<specIndex>
    const familyVolume = new Map();
    const familyObservations = new Map();

    candidates.forEach((refs, specIndex) => {
      new Set(refs.map((r) => familyKeyOf(r, kind))).forEach((key) => {
        if (!key) return;
        const set = coverage.get(key) || new Set();
        set.add(specIndex);
        coverage.set(key, set);
      });
      refs.forEach((ref) => {
        const key = familyKeyOf(ref, kind);
        if (!key) return;
        familyVolume.set(key, (familyVolume.get(key) || 0) + soldQty(ref.code));
        familyObservations.set(key, (familyObservations.get(key) || 0) + ref.observations);
      });
    });

    const assigned = new Array(specs.length);
    const uncovered = new Set(specs.map((_, i) => i).filter((i) => candidates[i].length));

    // 사용자가 기준품을 직접 고른 경우(3안)에는 그 선택을 먼저 존중한다.
    if (kind === 'existing') {
      specs.forEach((spec, i) => {
        if (!spec.preferredReferenceCode || !uncovered.has(i)) return;
        const picked = candidates[i].find((r) => r.code === spec.preferredReferenceCode);
        if (picked) {
          assigned[i] = picked;
          uncovered.delete(i);
        }
      });
    }

    while (uncovered.size) {
      const bestKey = [...coverage.keys()]
        .filter((key) => [...(coverage.get(key) || [])].some((i) => uncovered.has(i)))
        .sort((a, b) => {
          const covers = (key) => [...(coverage.get(key) || [])].filter((i) => uncovered.has(i)).length;
          return (
            covers(b) - covers(a) ||
            (familyVolume.get(b) || 0) - (familyVolume.get(a) || 0) ||
            (familyObservations.get(b) || 0) - (familyObservations.get(a) || 0)
          );
        })[0];
      if (!bestKey) break;

      [...(coverage.get(bestKey) || [])]
        .filter((i) => uncovered.has(i))
        .forEach((i) => {
          const inFamily = candidates[i].filter((r) => familyKeyOf(r, kind) === bestKey);
          assigned[i] = inFamily.sort((a, b) => {
            const gap = targetDistance(specs[i], a) - targetDistance(specs[i], b);
            // 목표 적합도가 8% 이내로 비슷하면 실적이 많은 쪽을 택한다.
            if (Math.abs(gap) > 0.08) return gap;
            return soldQty(b.code) - soldQty(a.code) || b.observations - a.observations || gap;
          })[0];
          uncovered.delete(i);
        });
    }
    return assigned;
  }

  /** 같은 크기(±3mm) 양극들이 실제로 담은 활물질 범위. 설계 시 이 범위를 넘지 않는다. 구엔진의 fm(). */
  function activeWeightRange(plate) {
    const sameSize = plates
      .filter(
        (p) =>
          (p.role === 'positive' || p.role === 'both') &&
          Math.abs(p.width - plate.width) <= 3 &&
          Math.abs(p.height - plate.height) <= 3 &&
          p.activeWeight > 0,
      )
      .map((p) => p.activeWeight);
    return sameSize.length ? [Math.min(...sameSize), Math.max(...sameSize)] : [plate.activeWeight, plate.activeWeight];
  }

  /* ---------- 격리판 봉합 극성 ---------- */

  /**
   * 봉합 극성은 설계자가 고르는 값이 아니라 극판 조합이 정하는 파생값이다.
   * 사내 실적 9,319건 분석 결과: 극판 조합만으로 99.7%, 제품군으로 95.0%가 결정된다
   * ("EFB면 (+)" 같은 단순 규칙은 74%로 무조건 (−)라고 하는 것(88%)보다도 나쁘다).
   * 그래서 규칙을 쓰지 않고 실적에서 끌어온다.
   */
  const separatorIndex = (() => {
    const byCombo = new Map();
    const byGroup = new Map();
    const bump = (map, key, value) => {
      if (!value) return;
      const entry = map.get(key) || { negative: 0, positive: 0 };
      entry[value] = (entry[value] || 0) + 1;
      map.set(key, entry);
    };
    for (const product of products) {
      bump(byCombo, `${product.posCode}|${product.negCode}`, product.separator);
      bump(byGroup, product.group, product.separator);
    }
    return { byCombo, byGroup };
  })();

  const SEPARATOR_LABEL = { negative: '(−)봉합', positive: '(+)봉합' };

  /**
   * @returns {{value:string|null, label:string, basis:string, agree:number, total:number, conflict:boolean}}
   *   value 가 null 이면 실적이 없어 판단하지 않는다(추측하지 않는다).
   */
  function separatorFor(posCode, negCode, group) {
    const pick = (entry, basis) => {
      if (!entry) return null;
      const total = entry.negative + entry.positive;
      if (!total) return null;
      const value = entry.negative >= entry.positive ? 'negative' : 'positive';
      const agree = entry[value];
      return {
        value,
        label: SEPARATOR_LABEL[value],
        basis,
        agree,
        total,
        // 소수 예외가 섞여 있으면 화면에서 "확인 필요"로 알린다.
        conflict: agree < total,
      };
    };
    return (
      pick(separatorIndex.byCombo.get(`${posCode}|${negCode}`), '극판 조합 실적') ||
      pick(separatorIndex.byGroup.get(group), '제품군 실적') || {
        value: null,
        label: '판단 불가',
        basis: '실적 없음',
        agree: 0,
        total: 0,
        conflict: false,
      }
    );
  }

  /** DB 실적에 존재하는 매수 범위. 구엔진의 gm(). */
  function plateCountRange(spec) {
    const observed = candidatesFor(spec)
      .map((r) => r.assembly)
      .filter((n) => n >= 7 && n <= 40);
    return observed.length ? [Math.min(...observed), Math.max(...observed)] : [7, Math.max(7, spec.maxPlates)];
  }

  /**
   * 예측 근거로 쓸 실적 제품 집합. 구엔진의 pm().
   * 용량(C20·RC)은 극판군/크기가 같은 제품군까지 넓게, CCA는 극판 코드가 완전히 같은 제품만.
   * CCA가 극판 조성·두께에 민감하기 때문입니다.
   */
  function evidenceSources(spec, kind, ref) {
    const groupRefs = candidatesFor(spec);
    const key = familyKeyOf(ref, kind);
    const sameFamily = groupRefs.filter((r) => familyKeyOf(r, kind) === key);
    const sameSizePair = groupRefs.filter((r) => sizePairKey(r) === sizePairKey(ref));

    const capacityPool = sameFamily.length >= 2 ? sameFamily : sameSizePair.length >= 2 ? sameSizePair : [ref];
    const capacitySelling = capacityPool.filter((r) => soldQty(r.code) > 0);
    const capacitySource = capacitySelling.length >= 2 ? capacitySelling : capacityPool;

    const sameCodes = groupRefs.filter((r) => r.posCode === ref.posCode && r.negCode === ref.negCode);
    const sameCodesSelling = sameCodes.filter((r) => soldQty(r.code) > 0);
    const ccaSource = sameCodesSelling.length ? sameCodesSelling : sameCodes.length ? sameCodes : [ref];

    return {
      capacitySource,
      ccaSource,
      ccaEvidenceProducts: ccaSource.length,
      observations: [...new Set([...capacitySource, ...ccaSource])].reduce((sum, r) => sum + r.observations, 0),
    };
  }

  /**
   * 매수별 실적값을 보간해 목표 매수의 값을 추정한다. 구엔진의 vi().
   * 같은 매수 실적이 있으면 그 값, 없으면 위아래 실적 사이 선형보간, 그것도 없으면 매수 비례.
   */
  function interpolateByPlateCount(sources, metric, plateCount, fallback) {
    const usable = sources.filter((r) => r[metric] > 0 && r.assembly > 0);
    const pool = usable.length ? usable : fallback[metric] > 0 ? [fallback] : [];
    if (!pool.length) return 0;

    const curve = [...new Set(pool.map((r) => r.assembly))]
      .sort((a, b) => a - b)
      .map((assembly) => ({
        assembly,
        value: weightedMedian(
          pool
            .filter((r) => r.assembly === assembly)
            .map((r) => ({ value: r[metric], weight: soldQty(r.code) || r.observations || 1 })),
        ),
      }));

    const exact = curve.find((p) => p.assembly === plateCount);
    if (exact) return exact.value;

    const below = [...curve].reverse().find((p) => p.assembly < plateCount);
    const above = curve.find((p) => p.assembly > plateCount);
    if (below && above) {
      return below.value + (above.value - below.value) * ((plateCount - below.assembly) / (above.assembly - below.assembly));
    }
    const anchor = below || above || curve[0];
    return (anchor.value * plateCount) / Math.max(1, anchor.assembly);
  }

  /**
   * 활물질 1g·양극 1매당 성능. 구엔진의 Pi().
   * 이 값에 (양극 매수 × 매당 활물질)을 곱하면 용량 예측이 된다.
   */
  function perActiveWeight(sources, metric, fallback) {
    const usable = sources.filter((r) => {
      const pos = plateByCode.get(r.posCode);
      return r[metric] > 0 && r.posQty > 0 && !!pos && pos.activeWeight > 0;
    });
    const pool = usable.length ? usable : [fallback];
    return weightedMedian(
      pool.map((r) => {
        const pos = plateByCode.get(r.posCode);
        const denominator = Math.max(1, r.posQty * (pos?.activeWeight || 1));
        return { value: r[metric] / denominator, weight: soldQty(r.code) || r.observations || 1 };
      }),
    );
  }

  /** 호환 극판이 없어 설계를 만들 수 없는 경우. 구엔진의 W2(). */
  function blockedDesign(spec, kind) {
    const profile = groupProfile(spec.group, spec.type);
    return {
      spec,
      reference: products.find((p) => p.group === spec.group) || products[0],
      compatibility: {
        valid: false,
        technology: profile.technology,
        positiveSize: '-',
        negativeSize: '-',
        allowedPositiveCodes: profile.positiveCodes,
        allowedNegativeCodes: profile.negativeCodes,
        familyKey: `BLOCKED:${spec.group}:${kind}`,
        familyLabel: '호환자료 없음',
        rule: profile.reason || '등록된 호환 조합 없음',
      },
      plateCount: spec.maxPlates,
      posCount: Math.ceil(spec.maxPlates / 2),
      negCount: Math.floor(spec.maxPlates / 2),
      cellCount: spec.cellCount || DEFAULT_CELL_COUNT,
      predictedC20: 0,
      predictedRc: 0,
      predictedEnCca: 0,
      predictedSaeCca: 0,
      c20Margin: -100,
      rcMargin: -100,
      ccaMargin: -100,
      saeMargin: -100,
      posCode: '사용불가',
      negCode: '사용불가',
      posName: '호환 극판 없음',
      negName: '호환 극판 없음',
      posThickness: '-',
      negThickness: '-',
      sourcePosThickness: '-',
      sourceNegThickness: '-',
      ccaThicknessFactor: 0,
      posGridWeight: 0,
      negGridWeight: 0,
      posActiveWeight: 0,
      posActiveRange: [0, 0],
      parallelPlateArea: 0,
      resistanceIndex: 0,
      ccaEvidenceProducts: 0,
      unitCost: 0,
      separator: { value: null, label: '판단 불가', basis: '호환 조합 없음', agree: 0, total: 0, conflict: false },
      predictedLead: 0,
      leadSource: '차단',
      leadBreakdown: null,
      confidence: 0,
      evidenceGrade: 'D',
      dbPlateRange: [0, 0],
      evaluatedPlateCounts: [],
      selectionReason: '호환 DB 없음',
      warning: profile.reason || `${spec.group} 제품군에 등록된 호환 극판 조합이 없습니다.`,
    };
  }

  /**
   * 제품 하나의 설계안을 계산한다. 구엔진의 Cm(). 엔진의 심장.
   *
   * 흐름: 근거 제품 수집 → DB가 허용하는 매수 범위 산정 → 매수를 낮은 쪽부터 훑으며
   *       필요한 활물질량을 역산 → 4개 성능을 모두 만족하는 최소 매수를 채택.
   */
  /**
   * @param {object} [overrides] 실시간 what-if 조절값. 넘기지 않으면 기존 동작과 완전히 같다.
   *   posThickness / negThickness (mm) · posActiveWeight (g/매) · plateCount (매)
   */
  function calculateDesign(spec, kind, ref, assumptions, overrides = {}) {
    /** 조절값이 실제로 들어왔는지. 0·NaN·undefined 는 "조절 안 함"으로 본다. */
    const tuned = (value) => Number.isFinite(value) && value > 0;
    if (!ref) return blockedDesign(spec, kind);
    const profile = groupProfile(spec.group, spec.type);
    const posPlate = plateByCode.get(ref.posCode);
    const negPlate = plateByCode.get(ref.negCode);
    if (!posPlate || !negPlate || !profile.valid) return blockedDesign(spec, kind);

    const cellCount = spec.cellCount > 0 ? spec.cellCount : DEFAULT_CELL_COUNT; // (수정 3)
    const evidence = evidenceSources(spec, kind, ref);
    const [dbMin, dbMax] = plateCountRange(spec);

    // 3안에서 사용자가 이 기준품을 직접 지정했으면 등록 BOM을 그대로 쓴다(재설계 없음).
    const referenceLocked = kind === 'existing' && spec.preferredReferenceCode === ref.code;
    /**
     * 기준품 고정 경로는 "이 제품이 곧 그 기준품"이라는 전제 위에 서 있어서
     * 성능·납중량을 실측값으로 그대로 돌려준다. 조절값이 들어오면 더 이상 그 제품이 아니므로
     * 실측값을 쓸 수 없다 — 모델로 다시 계산해야 조절이 결과에 반영된다.
     * (조절이 없으면 hasOverride 가 false 이므로 종전 동작과 완전히 같다)
     */
    const hasOverride =
      tuned(overrides.posThickness) ||
      tuned(overrides.negThickness) ||
      tuned(overrides.posActiveWeight) ||
      tuned(overrides.plateCount);
    const lockToReference = referenceLocked && !hasOverride;

    const upperBound = Math.floor(Math.min(clamp(spec.maxPlates, 7, 40), dbMax));
    const lowerBound = Math.min(dbMin, upperBound);
    const plateCounts = tuned(overrides.plateCount)
      ? [Math.round(overrides.plateCount)]
      : referenceLocked
        ? [ref.assembly] // 매수는 조절하지 않았다 — 기준품 매수를 유지한다
        : Array.from({ length: Math.max(1, upperBound - lowerBound + 1) }, (_, i) => lowerBound + i);

    const newPositive = kind !== 'existing';
    const newNegative = kind === 'new';

    // 실시간 조절: 기판두께를 지정하면 그 두께로 계산한다.
    // 지정이 없으면 종전 규칙(신형 양극 = 0.7T Punch, 그 외 = 등록 두께)을 그대로 쓴다.
    const posBaseT = parseThickness(posPlate.thickness);
    const negBaseT = parseThickness(negPlate.thickness);
    const posT = tuned(overrides.posThickness) ? overrides.posThickness : newPositive ? 0.7 : posBaseT;
    const negT = tuned(overrides.negThickness) ? overrides.negThickness : negBaseT;

    const posThickness = tuned(overrides.posThickness)
      ? `${posT.toFixed(2)}T (조정)`
      : newPositive
        ? '0.70T (Punch)'
        : posPlate.thickness;
    const negThickness = tuned(overrides.negThickness) ? `${negT.toFixed(2)}T (조정)` : negPlate.thickness;
    // 기판이 얇아진 만큼 기판중량이 줄어든다. (조절이 없으면 종전 값과 비트 단위로 같다: t/t = 1)
    const posGridWeight = posPlate.baseWeight * (posT / posBaseT);
    const negGridWeight = negPlate.baseWeight * (negT / negBaseT);
    const activeRange = activeWeightRange(posPlate);

    const posGridRatio = posGridWeight / Math.max(1, posPlate.baseWeight);
    const negGridRatio = negGridWeight / Math.max(1, negPlate.baseWeight);
    // 같은 매수에서 기판이 얇으면 도전 금속이 줄어 내부저항이 커지고 CCA가 내려간다(비율<1).
    // 실적 회귀가 아닌 보수적 근사이므로 −14%~+4% 범위로 잘라 쓴다.
    const ccaThicknessFactor = clamp(Math.sqrt((posGridRatio + negGridRatio) / 2), 0.86, 1.04);

    const c20PerActive = perActiveWeight(evidence.capacitySource, 'c20', ref);
    const rcPerActive = perActiveWeight(evidence.capacitySource, 'rc', ref);

    const posArea = posPlate.width * posPlate.height;
    const negArea = negPlate.width * negPlate.height;
    const referenceArea = posArea * Math.max(1, ref.posQty) + negArea * Math.max(1, ref.negQty);

    const evaluate = (plateCount) => {
      // 매수를 그대로 둔 채 두께·활물질만 조절할 때 양·음극 배분이 튀지 않도록,
      // 기준품 매수를 유지하는 동안은 기준품의 배분(4+/5− 같은 비대칭 포함)을 따른다.
      const keepReferenceSplit = referenceLocked && plateCount === ref.assembly;
      const posCount = keepReferenceSplit ? ref.posQty : Math.ceil(plateCount / 2);
      const negCount = keepReferenceSplit ? ref.negQty : Math.floor(plateCount / 2);

      // 목표 용량을 내려면 매당 활물질이 얼마나 필요한가(역산)
      const neededForC20 = uncalibrate('c20', spec.targetC20) / Math.max(1e-4, c20PerActive * posCount);
      const neededForRc = uncalibrate('rc', spec.targetRc) / Math.max(1e-4, rcPerActive * posCount);
      const requestedActive = Math.max(neededForC20, neededForRc);
      const posActiveWeight = tuned(overrides.posActiveWeight)
        ? overrides.posActiveWeight
        : referenceLocked
          ? posPlate.activeWeight // 활물질을 조절하지 않았으면 기준품 등록값 유지
          : clamp(requestedActive, activeRange[0], activeRange[1]);
      const activeRatio = posActiveWeight / Math.max(1, posPlate.activeWeight);

      // 보정은 "예측한 값"에만 건다. 기준품을 그대로 쓰는 경로(lockToReference)의 값은
      // 예측이 아니라 등록된 실측값이므로 손대면 안 된다.
      const predictedC20 = lockToReference ? ref.c20 : calibrate('c20', c20PerActive * posCount * posActiveWeight);
      const predictedRc = lockToReference ? ref.rc : calibrate('rc', rcPerActive * posCount * posActiveWeight);
      const predictedEnCca = lockToReference
        ? ref.encca
        : calibrate('encca', interpolateByPlateCount(evidence.ccaSource, 'encca', plateCount, ref) * ccaThicknessFactor);
      const predictedSaeCca = lockToReference
        ? ref.saecca
        : calibrate('saecca', interpolateByPlateCount(evidence.ccaSource, 'saecca', plateCount, ref) * ccaThicknessFactor);

      const parallelPlateArea = posArea * posCount + negArea * negCount;
      const resistanceIndex = referenceArea / Math.max(1, parallelPlateArea) / Math.max(0.1, ccaThicknessFactor);

      const pass =
        plateCount <= spec.maxPlates &&
        predictedC20 > 0 &&
        predictedRc > 0 &&
        predictedEnCca > 0 &&
        predictedSaeCca > 0 &&
        predictedC20 >= spec.targetC20 &&
        predictedRc >= spec.targetRc &&
        predictedEnCca >= spec.targetEnCca &&
        predictedSaeCca >= spec.targetSaeCca &&
        (lockToReference || requestedActive <= activeRange[1]);

      return {
        plateCount,
        posCount,
        negCount,
        requestedActive,
        posActiveWeight,
        activeRatio,
        predictedC20,
        predictedRc,
        predictedEnCca,
        predictedSaeCca,
        parallelPlateArea,
        resistanceIndex,
        pass,
      };
    };

    const evaluated = plateCounts.map(evaluate);
    // 낮은 매수부터 훑으므로 첫 통과안이 곧 "목표를 만족하는 최소 매수"다.
    const chosen = evaluated.find((x) => x.pass) || evaluated[evaluated.length - 1];

    // 신형 양극 단가: 기판비·활물질비 비중을 그 극판의 실제 구성으로 계산해 각각의 변화율을 반영한다.
    // (구엔진은 55/45 고정 분할 — 극판 마스터 회귀 기준 실제 기판 비중은 평균 40.7%, 31~50% 분포)
    const costShare = (plate) =>
      (PLATE_COST_PER_GRID_G * plate.baseWeight) /
      Math.max(1e-6, PLATE_COST_PER_GRID_G * plate.baseWeight + PLATE_COST_PER_ACTIVE_G * plate.activeWeight);
    const posGridCostShare = costShare(posPlate);
    /**
     * 기존 극판을 그대로 쓸 때는 등록 단가가 곧 단가다 — 그 극판을 사 오는 것이므로.
     * 그러나 실시간 조절로 두께나 활물질을 바꾸면 <b>더 이상 그 극판이 아니다.</b>
     * 그때도 등록 단가를 그대로 쓰면 "활물질을 1.5배 넣었는데 원가가 그대로"인 거짓말이 된다.
     * 신형 극판과 같은 방식(기판비·활물질비 비중별 변화율)으로 환산한다.
     * (조절이 없으면 두 비율이 정확히 1이므로 종전 값과 같다 — parity 가 이를 지킨다)
     */
    const posTuned = tuned(overrides.posThickness) || tuned(overrides.posActiveWeight);
    const posCost =
      posPlate.cost *
      (newPositive || posTuned ? posGridCostShare * posGridRatio + (1 - posGridCostShare) * chosen.activeRatio : 1);

    // 음극은 활물질을 조절하지 않으므로 기판두께 변화만 단가에 싣는다.
    const negGridCostShare = costShare(negPlate);
    const negCost =
      negPlate.cost * (tuned(overrides.negThickness) ? negGridCostShare * negGridRatio + (1 - negGridCostShare) : 1);
    const materialCost = (posCost * chosen.posCount + negCost * chosen.negCount) * cellCount;

    /* ---- 납중량 ---- */
    // 신형 극판은 얇아진 기판중량(posGridWeight)이, 활물질 재배분은 chosen.posActiveWeight 가 그대로 반영된다.
    const gridLeadKg = (posGridWeight * chosen.posCount + negGridWeight * chosen.negCount) * cellCount / 1000;
    const activeLeadKg =
      ((chosen.posActiveWeight * chosen.posCount) / LEAD_ACTIVE_DIVISOR_POS +
        (negPlate.activeWeight * chosen.negCount) / LEAD_ACTIVE_DIVISOR_NEG) *
      cellCount / 1000;
    const cosLeadKg = Math.max(0, LEAD_COS_INTERCEPT * (cellCount / DEFAULT_CELL_COUNT) + LEAD_COS_PER_GRID_KG * gridLeadKg);
    // 기준품 고정 경로는 등록 실측 납중량이 있으면 그것을 쓴다. 실측은 항상 모델보다 낫다.
    const leadIsActual = lockToReference && ref.lead > 0;
    const predictedLead = leadIsActual ? ref.lead : gridLeadKg + activeLeadKg + cosLeadKg;

    const warning = chosen.pass
      ? chosen.requestedActive > activeRange[1]
        ? `동일 크기 활물질 상한 ${round(activeRange[1], 1)} g/매에 도달했습니다.`
        : null
      : `DB 실적 매수범위 ${dbMin}–${dbMax}매와 입력 상한 ${spec.maxPlates}매 안에서 목표를 모두 충족하지 못했습니다.`;

    const posSize = sizeKey(posPlate);
    const negSize = sizeKey(negPlate);
    const grade = evidenceGrade([...new Set([...evidence.capacitySource, ...evidence.ccaSource])]);
    const confidence = clamp(50 + { A: 38, B: 27, C: 15, D: 0 }[grade] - (warning ? 10 : 0), 35, 92);

    const selectionReason = chosen.pass
      ? lockToReference
        ? `기존 PCC ${ref.code}의 등록 BOM·성능·${chosen.plateCount}매를 그대로 적용`
        : `${evaluated.length}개 DB 허용 매수를 검토해 목표를 모두 충족하는 최소 ${chosen.plateCount}매 선택`
      : `${evaluated.length}개 DB 허용 매수를 검토했으나 상한 ${chosen.plateCount}매에서도 일부 목표 미충족`;

    return {
      spec,
      reference: ref,
      compatibility: {
        valid: true,
        technology: profile.technology,
        positiveSize: posSize,
        negativeSize: negSize,
        allowedPositiveCodes: profile.positiveCodes,
        allowedNegativeCodes: profile.negativeCodes,
        familyKey: familyKeyOf(ref, kind),
        familyLabel:
          kind === 'new'
            ? `신형 +${posSize} / −${negSize}`
            : kind === 'hybrid'
              ? `신형 +${posSize} / 기존 −${negPlate.code}`
              : `기존 ${posPlate.code} / ${negPlate.code}`,
        rule: `${spec.group} 실적에서 허용된 +${posSize} / −${negSize}만 적용`,
      },
      plateCount: chosen.plateCount,
      posCount: chosen.posCount,
      negCount: chosen.negCount,
      cellCount,
      predictedC20: round(chosen.predictedC20, 1),
      predictedRc: round(chosen.predictedRc),
      predictedEnCca: round(chosen.predictedEnCca / 10) * 10, // CCA는 10A 단위로 제시
      predictedSaeCca: round(chosen.predictedSaeCca / 10) * 10,
      c20Margin: marginPct(chosen.predictedC20, spec.targetC20),
      rcMargin: marginPct(chosen.predictedRc, spec.targetRc),
      ccaMargin: marginPct(chosen.predictedEnCca, spec.targetEnCca),
      saeMargin: marginPct(chosen.predictedSaeCca, spec.targetSaeCca),
      posCode: newPositive ? `NEW-${posPlate.width}${posPlate.height}-P07` : posPlate.code,
      negCode: newNegative
        ? `NEW-${negPlate.width}${negPlate.height}-N${parseThickness(negPlate.thickness).toFixed(2).replace('.', '')}`
        : negPlate.code,
      posName: newPositive ? `${posSize} PH 0.7T` : posPlate.name,
      negName: newNegative ? `${negSize} NH ${negPlate.thickness}` : negPlate.name,
      posThickness,
      negThickness,
      sourcePosThickness: posPlate.thickness,
      sourceNegThickness: negPlate.thickness,
      ccaThicknessFactor: round(ccaThicknessFactor, 3),
      posGridWeight: round(posGridWeight, 1),
      negGridWeight: round(negGridWeight, 1),
      posActiveWeight: round(chosen.posActiveWeight, 1),
      posActiveRange: [round(activeRange[0], 1), round(activeRange[1], 1)],
      parallelPlateArea: round(chosen.parallelPlateArea),
      resistanceIndex: round(chosen.resistanceIndex, 3),
      ccaEvidenceProducts: evidence.ccaEvidenceProducts,
      unitCost: round((materialCost + assumptions.conversionCost) * (1 + assumptions.contingencyRate / 100)),
      // 봉합은 신형/기존과 무관하게 "원본 극판 조합"의 실적을 따른다.
      // 신형 극판은 같은 크기 극판을 다시 만드는 것이므로 봉합 방식이 바뀔 이유가 없다.
      separator: separatorFor(posPlate.code, negPlate.code, spec.group),
      predictedLead: round(predictedLead, 2),
      leadSource: leadIsActual ? '실측' : '모델',
      leadBreakdown: leadIsActual
        ? null
        : { grid: round(gridLeadKg, 2), active: round(activeLeadKg, 2), cos: round(cosLeadKg, 2) },
      confidence: round(confidence),
      evidenceGrade: grade,
      dbPlateRange: [dbMin, dbMax],
      evaluatedPlateCounts: plateCounts,
      selectionReason,
      warning,
    };
  }

  const PLAN_META = {
    new: {
      label: '1안 · 모두 신형 극판',
      shortLabel: '신형 중심',
      description:
        '제품군별 허용 크기 안에서 신형 양·음극을 설계합니다. 양극은 PH 0.7T Punch, 음극 기판두께는 기존 DB 등록값을 적용합니다.',
      developmentMonths: 5.5,
      risk: '높음',
      strengths: ['DB 허용 크기 내 성능 튜닝', '호환 제품군끼리 신형 극판 공용', 'PH 0.7T Punch 적용'],
      cautions: ['극판군별 금형·검증 투자 필요', '제품군별 패킹 검증 필요'],
    },
    hybrid: {
      label: '2안 · 신형 + 기존 공용',
      shortLabel: '균형안',
      description: '제품군별 허용 크기의 신형 양극과 해당 제품군에 등록된 기존 음극만 조합합니다.',
      developmentMonths: 3.5,
      risk: '보통',
      strengths: ['신형 양극으로 CCA 대응', '제품군 허용 음극 재사용', '호환성·투자비 균형'],
      cautions: ['양·음극 밸런스 검증 필요', '제품군 간 크기 강제 공용 금지'],
    },
    existing: {
      label: '3안 · 기존 극판 공용',
      shortLabel: '원가 중심',
      description: '각 제품군에 실제 적용된 기존 극판 조합만 사용하고, 동일 코드 조합끼리 공용화합니다.',
      developmentMonths: 1.5,
      risk: '낮음',
      strengths: ['신규 금형 없음', '제품군별 기존 실적 활용', '동일 코드 조합만 공용'],
      cautions: ['고사양 제품은 매수 한도 가능', '호환되지 않는 제품군은 별도 극판군'],
    },
  };

  const OBJECTIVE_BONUS = {
    performance: { new: 10, hybrid: 4, existing: -6 },
    cost: { new: -7, hybrid: 3, existing: 10 },
    balanced: { new: 0, hybrid: 8, existing: 1 },
  };

  /** 라인업 전체에 대한 설계안 하나. 구엔진의 bi(). */
  function buildPlan(specs, kind, objective, assumptions) {
    const references = assignReferences(specs, kind);
    const raw = specs.map((spec, i) => calculateDesign(spec, kind, references[i], assumptions));
    return aggregatePlan(raw, kind, objective, assumptions);
  }

  /**
   * 제품별 설계들을 라인업 하나로 묶는다 — 금형비 분담, 가중 평균원가, 공용화율, 점수.
   *
   * buildPlan 과 retunePlan(실시간 조절)이 <b>같은</b> 집계를 쓰게 하려고 따로 뺐다.
   * 라인업 숫자를 두 곳에서 따로 계산하면 언젠가 서로 어긋난다.
   */
  function aggregatePlan(raw, kind, objective, assumptions) {
    // 금형 투자는 극판군 단위로 1회 발생하므로, 그 극판군을 쓰는 물량 전체에 나눠 싣는다.
    const volumeByFamily = new Map();
    const countByFamily = new Map();
    raw
      .filter((d) => d.compatibility.valid)
      .forEach((d) => {
        const key = d.compatibility.familyKey;
        volumeByFamily.set(key, (volumeByFamily.get(key) || 0) + d.spec.annualVolume);
        countByFamily.set(key, (countByFamily.get(key) || 0) + 1);
      });

    const toolingCost = kind === 'new' ? assumptions.newToolingCost : kind === 'hybrid' ? assumptions.hybridToolingCost : 0;
    const designs = raw.map((d) => ({
      ...d,
      unitCost: round(d.unitCost + toolingCost / Math.max(1, volumeByFamily.get(d.compatibility.familyKey) || 0)),
    }));

    const totalVolume = designs.reduce((sum, d) => sum + d.spec.annualVolume, 0);
    const averageCost = designs.reduce((sum, d) => sum + d.unitCost * d.spec.annualVolume, 0) / Math.max(1, totalVolume);

    const families = new Set(designs.filter((d) => d.compatibility.valid).map((d) => d.compatibility.familyKey));
    // (수정 2) 유효한 극판군이 하나도 없으면 공용화율은 0%다.
    const commonization = families.size === 0 ? 0 : Math.round((1 - (families.size - 1) / Math.max(1, designs.length)) * 100);

    const sharedVolume = designs
      .filter((d) => (countByFamily.get(d.compatibility.familyKey) || 0) > 1)
      .reduce((sum, d) => sum + d.spec.annualVolume, 0);
    const commonizedVolumeShare = round((sharedVolume / Math.max(1, totalVolume)) * 100);

    const passRatio =
      designs.filter(
        (d) => d.compatibility.valid && !d.warning && METRIC_MARGINS.every((k) => (d[k] ?? -1) >= 0),
      ).length / Math.max(1, designs.length);

    const meta = PLAN_META[kind];
    const score = clamp(
      Math.round(passRatio * 52 + commonizedVolumeShare * 0.2 + commonization * 0.1 + (1 - averageCost / 50000) * 18 + OBJECTIVE_BONUS[objective][kind]),
      1,
      98,
    );

    return {
      kind,
      label: meta.label,
      shortLabel: meta.shortLabel,
      description: meta.description,
      designs,
      averageCost: round(averageCost),
      developmentCost: toolingCost * families.size,
      developmentMonths: meta.developmentMonths,
      commonFamilies: families.size,
      commonization,
      commonizedVolumeShare,
      toolingFamilies: toolingCost ? families.size : 0,
      score,
      risk: meta.risk,
      strengths: meta.strengths,
      cautions: meta.cautions,
    };
  }

  const METRIC_MARGINS = ['c20Margin', 'rcMargin', 'ccaMargin', 'saeMargin'];

  /**
   * 실시간 조절: 제품별 조절값을 반영해 <b>라인업 전체를</b> 다시 집계한다.
   *
   * 제품 하나만 만져도 라인업 숫자는 같이 움직인다 — 금형비를 나눠 지는 물량이 달라지고,
   * 가중 평균원가·목표충족 수가 바뀌기 때문이다. 제품 카드만 다시 계산하고 라인업 KPI는
   * 그대로 두면, 조절해도 "평균원가 26,920원" 이 꿈쩍 않는 거짓말이 된다.
   *
   * 기준품은 확정 설계가 쓰던 것을 그대로 쓴다. 여기서 기준품까지 다시 고르면
   * 숫자가 움직인 원인이 조절 때문인지 기준품이 바뀌어서인지 구분할 수 없다.
   *
   * @param {object} plan 확정된 설계안
   * @param {object[]} specs 현재 라인업 (요구사양이 바뀌었을 수 있으므로 uid 로 다시 찾는다)
   * @param {string} objective 비교 관점
   * @param {object} assumptions 원가 가정
   * @param {Record<string, object>} overridesByUid 제품 uid → 조절값
   */
  function retunePlan(plan, specs, objective, assumptions, overridesByUid = {}) {
    const raw = plan.designs.map((design) => {
      const spec = specs.find((item) => item.uid === design.spec.uid) || design.spec;
      return calculateDesign(spec, plan.kind, design.reference, assumptions, overridesByUid[design.spec.uid] || {});
    });
    return aggregatePlan(raw, plan.kind, objective, assumptions);
  }

  /**
   * 극판군 통합 곡선 — "극판을 1종 더 만들면 연간 얼마를 버는가".
   *
   * 금형비가 0이면 극판군을 합쳐서 아낄 돈이 없다. 오히려 합칠수록 일부 제품이 자기 최적보다
   * 큰 극판을 쓰게 되어 재료비가 는다. 그래서 "몇 개가 최적인가"는 원가만으로는 답이 나오지
   * 않는다 — 원가만 보면 극판이 많을수록 항상 유리하기 때문이다.
   *
   * 대신 답할 수 있는 질문이 이것이다. 극판 1종이 늘 때 생기는 부동재고 부담은 도구가 모르지만,
   * 그 부담과 견줄 <b>연간 절감액</b>은 계산할 수 있다. 꺾이는 지점이 곧 판단 지점이다.
   *
   * 방법: 현재 안의 극판군에서 출발해, 라인업 연간 총원가를 가장 크게 낮추는 극판군을
   * 하나씩 더해 간다. 시설입지 문제와 같은 꼴이라 탐욕법이 최적해를 보장하지는 않지만,
   * 꺾이는 지점을 찾는 데는 충분하다. 더해도 원가가 내려가지 않으면 거기서 멈춘다.
   *
   * @returns {Array<{familyCount, plan, annualCost, marginalSaving, passCount, totalProducts, families}>}
   *          극판군 수 오름차순. 첫 점이 현재 안이다.
   */
  function consolidationCurve(specs, kind, objective, assumptions) {
    const usable = specs.filter((spec) => candidatesFor(spec).length);
    if (usable.length < 2) return [];

    /** 같은 극판군 안에서 어느 기준품이 나은가. assignReferences 와 같은 기준을 쓴다. */
    const preferBetween = (spec, a, b) => {
      const gap = targetDistance(spec, a) - targetDistance(spec, b);
      if (Math.abs(gap) > 0.08) return gap < 0 ? a : b;
      const bySales = soldQty(b.code) - soldQty(a.code) || b.observations - a.observations || gap;
      return bySales < 0 ? a : b;
    };

    // 제품별로 "이 극판군을 쓴다면 기준품은 무엇인가"
    const refByFamily = specs.map((spec) => {
      const map = new Map();
      candidatesFor(spec).forEach((ref) => {
        const key = familyKeyOf(ref, kind);
        if (!key) return;
        const prev = map.get(key);
        map.set(key, prev ? preferBetween(spec, ref, prev) : ref);
      });
      return map;
    });

    const designCache = new Map();
    const designOf = (index, key) => {
      const cacheKey = `${index} ${key}`;
      if (!designCache.has(cacheKey)) {
        designCache.set(cacheKey, calculateDesign(specs[index], kind, refByFamily[index].get(key), assumptions));
      }
      return designCache.get(cacheKey);
    };
    const meetsTargets = (design) =>
      design.compatibility.valid && METRIC_MARGINS.every((k) => (design[k] ?? -1) >= 0);
    const worstMarginOf = (design) => Math.min(...METRIC_MARGINS.map((k) => design[k] ?? -100));

    /**
     * 고른 극판군들 안에서 제품별 최선을 고른다.
     * 목표를 만족하는 것이 먼저다 — 통합해서 싸졌는데 성능이 미달이면 그건 대안이 아니다.
     */
    const assign = (chosen) =>
      specs.map((spec, index) => {
        const options = [...chosen].filter((key) => refByFamily[index].has(key));
        if (!options.length) return null;
        const designs = options.map((key) => ({ key, design: designOf(index, key) }));
        const passing = designs.filter((x) => meetsTargets(x.design));
        const pool = passing.length ? passing : designs;
        return pool.reduce((best, x) =>
          !best ? x
            : passing.length
              ? x.design.unitCost < best.design.unitCost ? x : best
              : worstMarginOf(x.design) > worstMarginOf(best.design) ? x : best,
        null);
      });

    const annualCostOf = (picks) =>
      picks.reduce((sum, pick, index) => sum + (pick ? pick.design.unitCost * (specs[index].annualVolume || 0) : 0), 0);

    const pointFor = (chosen) => {
      const picks = assign(chosen);
      const designs = picks.map((pick, index) =>
        pick ? pick.design : calculateDesign(specs[index], kind, null, assumptions),
      );
      const plan = aggregatePlan(designs, kind, objective, assumptions);
      const families = [...new Set(picks.filter(Boolean).map((pick) => pick.key))];
      return {
        familyCount: families.length,
        families,
        plan,
        annualCost: Math.round(
          plan.designs.reduce((sum, d) => sum + d.unitCost * (d.spec.annualVolume || 0), 0),
        ),
        passCount: plan.designs.filter(meetsTargets).length,
        totalProducts: plan.designs.length,
        marginalSaving: 0,
      };
    };

    const startFamilies = new Set(
      assignReferences(specs, kind).filter(Boolean).map((ref) => familyKeyOf(ref, kind)).filter(Boolean),
    );
    const allFamilies = new Set(refByFamily.flatMap((map) => [...map.keys()]));
    if (!startFamilies.size) return [];

    const chosen = new Set(startFamilies);
    const points = [pointFor(chosen)];

    while (chosen.size < allFamilies.size) {
      let best = null;
      for (const key of allFamilies) {
        if (chosen.has(key)) continue;
        const cost = annualCostOf(assign(new Set([...chosen, key])));
        if (!best || cost < best.cost) best = { key, cost };
      }
      // 더 만들어도 원가가 안 내려가면 거기가 끝이다. 부담만 늘고 얻는 게 없다.
      if (!best || best.cost >= points[points.length - 1].annualCost) break;
      chosen.add(best.key);
      const point = pointFor(chosen);
      point.marginalSaving = points[points.length - 1].annualCost - point.annualCost;
      // 극판군을 더했는데 실제로 쓰이지 않았다면 곡선에 새 점이 생기지 않는다.
      if (point.familyCount <= points[points.length - 1].familyCount) break;
      points.push(point);
    }

    return points;
  }

  /** 1·2·3안 한꺼번에. 구엔진의 An(). */
  function buildPlans(specs, objective = 'balanced', assumptions) {
    return [
      buildPlan(specs, 'new', objective, assumptions),
      buildPlan(specs, 'hybrid', objective, assumptions),
      buildPlan(specs, 'existing', objective, assumptions),
    ];
  }

  function planSummary(plan) {
    const passCount = plan.designs.filter(
      (d) => d.compatibility.valid && !d.warning && METRIC_MARGINS.every((k) => (d[k] ?? -1) >= 0),
    ).length;
    const margins = plan.designs.flatMap((d) => METRIC_MARGINS.map((k) => d[k]).filter((v) => v !== null));
    return {
      passCount,
      worstMargin: margins.length ? Math.min(...margins) : -100,
      averageEvidence: plan.designs.reduce((sum, d) => sum + d.confidence, 0) / Math.max(1, plan.designs.length),
    };
  }

  /** 목표충족 수를 1순위로, 나머지는 사용자가 고른 관점 순으로 정렬. 구엔진의 Ai(). */
  function rankPlans(plans, objective) {
    const basis = {
      performance: '목표충족 수 → 최저 성능여유 → DB 근거 → 평균원가',
      cost: '목표충족 수 → 평균원가 → 개발투자 → 공용물량',
      balanced: '목표충족 수 → 공용물량 → 평균원가 → 개발기간',
    }[objective];

    return plans
      .map((plan) => ({ plan, ...planSummary(plan) }))
      .sort((a, b) => {
        if (a.passCount !== b.passCount) return b.passCount - a.passCount;
        if (objective === 'performance') {
          return (
            b.worstMargin - a.worstMargin ||
            b.averageEvidence - a.averageEvidence ||
            a.plan.averageCost - b.plan.averageCost
          );
        }
        if (objective === 'cost') {
          return (
            a.plan.averageCost - b.plan.averageCost ||
            a.plan.developmentCost - b.plan.developmentCost ||
            b.plan.commonizedVolumeShare - a.plan.commonizedVolumeShare
          );
        }
        return (
          b.plan.commonizedVolumeShare - a.plan.commonizedVolumeShare ||
          a.plan.averageCost - b.plan.averageCost ||
          a.plan.developmentMonths - b.plan.developmentMonths ||
          b.averageEvidence - a.averageEvidence
        );
      })
      .map((entry, index) => ({
        kind: entry.plan.kind,
        rank: index + 1,
        passCount: entry.passCount,
        totalProducts: entry.plan.designs.length,
        allTargetsMet: entry.passCount === entry.plan.designs.length,
        worstMargin: round(entry.worstMargin, 1),
        averageEvidence: round(entry.averageEvidence),
        decisionBasis: basis,
      }));
  }

  /* ---------- DB 자체 백테스트 ---------- */

  /**
   * 실적 제품 하나를 빼고 같은 극판 조합의 나머지로 그 제품을 예측해 오차를 본다.
   * 예측식이 DB 자신을 얼마나 재현하는지의 하한선이며, 신제품 정확도의 보증은 아니다.
   */
  function backtest(metric) {
    const errors = [];
    products.forEach((target) => {
      if (target[metric] <= 0) return;
      const peers = referencesOf(target.group).filter(
        (p) => p.code !== target.code && p.posCode === target.posCode && p.negCode === target.negCode && p[metric] > 0,
      );
      if (!peers.length) return;

      let predicted = 0;
      if (metric === 'c20' || metric === 'rc') {
        const pos = plateByCode.get(target.posCode);
        if (!pos || target.posQty <= 0) return;
        predicted = perActiveWeight(peers, metric, target) * target.posQty * pos.activeWeight;
      } else {
        predicted = interpolateByPlateCount(peers, metric, target.assembly, target);
      }
      if (predicted > 0) errors.push((Math.abs(predicted - target[metric]) / target[metric]) * 100);
    });
    return {
      samples: errors.length,
      mape: errors.length ? round(errors.reduce((a, b) => a + b, 0) / errors.length, 1) : 0,
    };
  }

  const dbStats = {
    references: products.length,
    plates: plates.length,
    groups: groups.length,
    readyCurrentGroups: groupLearning.filter(
      (g) =>
        g.currentProducts > 0 &&
        g.assembly.typical > 0 &&
        g.performance.c20.typical > 0 &&
        g.performance.rc.typical > 0 &&
        g.performance.enCca.typical > 0 &&
        g.performance.saeCca.typical > 0,
    ).length,
    missing: {
      dimensions: products.filter((p) => !p.L || !p.W || !p.H).length,
      rc: products.filter((p) => !p.rc).length,
      enCca: products.filter((p) => !p.encca).length,
      saeCca: products.filter((p) => !p.saecca).length,
      weight: products.filter((p) => !p.weight).length,
      lead: products.filter((p) => !p.lead).length,
    },
  };

  // 백테스트는 740개 제품 전수 계산이라 비싸다. 실제로 열어볼 때 한 번만 돌고 그 뒤로는 캐시를 준다.
  let backtestCache = null;
  const backtestAll = () =>
    (backtestCache ??= {
      c20: backtest('c20'),
      rc: backtest('rc'),
      enCca: backtest('encca'),
      saeCca: backtest('saecca'),
    });

  return {
    meta: db.meta,
    calibration, // 지금 예측에 실제로 적용 중인 보정식. null 이면 보정 없음.
    plates,
    products,
    salesQty,
    plateByCode,
    soldQty,
    sizeKey,
    technologyOf,
    groups,
    groupProfile,
    groupLearning,
    learningByGroup,
    referencesOf,
    candidatesFor,
    matchExisting,
    familyKeyOf,
    assignReferences,
    calculateDesign,
    plateCountRange,
    separatorFor,
    activeWeightRange,
    buildPlan,
    retunePlan,
    consolidationCurve,
    buildPlans,
    planSummary,
    rankPlans,
    backtest,
    backtestAll,
    dbStats,
  };
}

/**
 * 원가 가정 기본값. 과제마다 요구사양 화면에서 바꿀 수 있다.
 *
 * 금형비가 0인 이유: 사내에서는 극판 금형이 이미 확보되어 있어 신규 극판을 만들 때
 * 별도 금형투자가 발생하지 않는다. 구엔진은 극판군당 2,600만/1,200만원을 잡고 있었는데
 * 그 값이 신형안(1·2안) 대당 원가에 분담금으로 실려, 실제로는 나가지 않는 돈이
 * 원가 비교와 안 순위를 왜곡했다. 0으로 바로잡는다.
 *
 * 투자가 실제로 발생하는 과제(신규 사이즈 금형 등)라면 요구사양 화면에서 그때 넣으면 된다.
 */
export const DEFAULT_ASSUMPTIONS = {
  conversionCost: 14300, // 조립·전해액 등 극판 외 대당 가공비
  newToolingCost: 0, // 신형 양·음극 투자 (극판군당) — 금형 확보분 사용
  hybridToolingCost: 0, // 신형 양극만 개발할 때의 투자 (극판군당)
  contingencyRate: 3, // 재료비 우발률 %
  /**
   * 극판을 1종 더 운용할 때 해마다 생기는 부동재고 부담 (원/종/년).
   * 금형비와 달리 이 부담은 극판 종류가 늘면 실제로 발생한다. 0으로 두면 도구가 판단하지 않고
   * 연간 절감액만 보여준다 — 그때는 이 금액을 아는 사람이 직접 견주면 된다.
   */
  inventoryBurdenPerFamily: 0,
};

export { DEFAULT_CELL_COUNT };
