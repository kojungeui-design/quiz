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
  function calculateDesign(spec, kind, ref, assumptions) {
    if (!ref) return blockedDesign(spec, kind);
    const profile = groupProfile(spec.group, spec.type);
    const posPlate = plateByCode.get(ref.posCode);
    const negPlate = plateByCode.get(ref.negCode);
    if (!posPlate || !negPlate || !profile.valid) return blockedDesign(spec, kind);

    const cellCount = spec.cellCount > 0 ? spec.cellCount : DEFAULT_CELL_COUNT; // (수정 3)
    const evidence = evidenceSources(spec, kind, ref);
    const [dbMin, dbMax] = plateCountRange(spec);

    // 3안에서 사용자가 이 기준품을 직접 지정했으면 등록 BOM을 그대로 쓴다(재설계 없음).
    const lockToReference = kind === 'existing' && spec.preferredReferenceCode === ref.code;

    const upperBound = Math.floor(Math.min(clamp(spec.maxPlates, 7, 40), dbMax));
    const lowerBound = Math.min(dbMin, upperBound);
    const plateCounts = lockToReference
      ? [ref.assembly]
      : Array.from({ length: Math.max(1, upperBound - lowerBound + 1) }, (_, i) => lowerBound + i);

    const newPositive = kind !== 'existing';
    const newNegative = kind === 'new';

    const posThickness = newPositive ? '0.70T (Punch)' : posPlate.thickness;
    const negThickness = negPlate.thickness;
    // 신형 양극은 0.7T Punch 기판으로 환산. 기판이 얇아진 만큼 기판중량이 줄어든다.
    const posGridWeight = newPositive ? posPlate.baseWeight * (0.7 / parseThickness(posPlate.thickness)) : posPlate.baseWeight;
    const negGridWeight = negPlate.baseWeight;
    const activeRange = activeWeightRange(posPlate);

    const posGridRatio = posGridWeight / Math.max(1, posPlate.baseWeight);
    const negGridRatio = negGridWeight / Math.max(1, negPlate.baseWeight);
    // 기판이 얇아지면 매수 대비 도전 경로가 늘어 CCA가 오른다. 실적 회귀가 아닌 보수적 근사이므로 ±4~14%로 잘라 쓴다.
    const ccaThicknessFactor = clamp(Math.sqrt((posGridRatio + negGridRatio) / 2), 0.86, 1.04);

    const c20PerActive = perActiveWeight(evidence.capacitySource, 'c20', ref);
    const rcPerActive = perActiveWeight(evidence.capacitySource, 'rc', ref);

    const posArea = posPlate.width * posPlate.height;
    const negArea = negPlate.width * negPlate.height;
    const referenceArea = posArea * Math.max(1, ref.posQty) + negArea * Math.max(1, ref.negQty);

    const evaluate = (plateCount) => {
      const posCount = lockToReference ? ref.posQty : Math.ceil(plateCount / 2);
      const negCount = lockToReference ? ref.negQty : Math.floor(plateCount / 2);

      // 목표 용량을 내려면 매당 활물질이 얼마나 필요한가(역산)
      const neededForC20 = uncalibrate('c20', spec.targetC20) / Math.max(1e-4, c20PerActive * posCount);
      const neededForRc = uncalibrate('rc', spec.targetRc) / Math.max(1e-4, rcPerActive * posCount);
      const requestedActive = Math.max(neededForC20, neededForRc);
      const posActiveWeight = lockToReference ? posPlate.activeWeight : clamp(requestedActive, activeRange[0], activeRange[1]);
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

    // 신형 양극 단가: 기판비 55% + 활물질비 45% 로 나눠 각각의 변화율을 반영한다.
    const posCost = posPlate.cost * (newPositive ? 0.55 * posGridRatio + 0.45 * chosen.activeRatio : 1);
    const negCost = negPlate.cost;
    const materialCost = (posCost * chosen.posCount + negCost * chosen.negCount) * cellCount;

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
    activeWeightRange,
    buildPlan,
    buildPlans,
    planSummary,
    rankPlans,
    backtest,
    backtestAll,
    dbStats,
  };
}

export const DEFAULT_ASSUMPTIONS = {
  conversionCost: 14300, // 조립·전해액 등 극판 외 대당 가공비
  newToolingCost: 26000000, // 신형 양·음극 금형/검증 투자 (극판군당)
  hybridToolingCost: 12000000, // 신형 양극만 개발할 때의 투자 (극판군당)
  contingencyRate: 3, // 재료비 우발률 %
};

export { DEFAULT_CELL_COUNT };
