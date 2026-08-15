/**
 * src/views/whatif.js — 실시간 설계 조절 (what-if).
 *
 * 계산이 끝난 설계안에서 기판두께·활물질량·매수를 슬라이더로 움직이면
 * 성능·납중량·원가가 그 자리에서 다시 계산된다.
 *
 * 설계 원칙
 *   · 조절은 화면에서만 산다. 과제에 저장하지 않는다 — 결재로 흘러가면 안 되는 탐색용 값이다.
 *     (저장이 필요하면 요구사양을 바꿔 정식으로 다시 계산하는 것이 맞다)
 *   · 기준선(조절 전)과 항상 나란히 보여준다. 얼마나 움직였는지가 핵심 정보다.
 *   · 실적 범위를 벗어나면 막지 않되 분명히 알린다. 탐색은 되어야 하고, 착각은 없어야 한다.
 *   · 슬라이더를 놓을 때가 아니라 끄는 동안 계속 갱신한다(input 이벤트).
 */
import { h, icon } from '../lib/dom.js';
import { num, won, eok, margin, marginClass } from '../core/format.js';
import { notice } from './parts.js';

const THICKNESS_MIN = 0.5;
const THICKNESS_MAX = 1.3;
const THICKNESS_STEP = 0.01;

/** 표시용: 조절 전 대비 증감. 0 근처는 "동일"로 묶어 잡음을 줄인다. */
function deltaText(now, base, digits = 0, unit = '') {
  if (!Number.isFinite(now) || !Number.isFinite(base)) return null;
  const diff = now - base;
  const eps = digits === 0 ? 0.5 : 0.5 / 10 ** digits;
  if (Math.abs(diff) < eps) return { text: '동일', tone: 'same' };
  return {
    text: `${diff > 0 ? '+' : '−'}${num(Math.abs(diff), digits)}${unit}`,
    tone: diff > 0 ? 'up' : 'down',
  };
}

/**
 * 카드 전체. 제품이 여럿이면 헤더에서 고를 수 있고, 고를 때마다 카드를 새로 만든다.
 * (조절 상태는 제품마다 다르므로 새로 만드는 편이 상태를 되돌리는 것보다 단순하다)
 *
 * @param {object} ctx
 * @param {object} plan 현재 선택안
 */
export function whatIfCard(ctx, plan) {
  const mount = h('div.whatif-mount');
  // 기준품을 못 찾아 막힌 설계는 조절할 것이 없다. 조절 가능한 제품만 고를 수 있게 한다.
  const tunable = plan.designs.filter((d) => d.compatibility && d.compatibility.valid && d.reference);
  if (!tunable.length) return mount;

  /**
   * 조절값은 제품마다 따로, 그리고 <b>카드 바깥에</b> 둔다.
   * 카드 안에 두면 제품을 바꿨다 돌아올 때 조절이 날아간다 — 라인업을 비교하려고
   * 제품을 오가는 것이 정상 사용인데, 그때마다 초기화되면 쓸 수가 없다.
   */
  const states = new Map(tunable.map((design) => [design.spec.uid, baseValuesOf(design)]));

  let index = 0;
  const build = () => {
    mount.replaceChildren(
      designCard(ctx, plan, tunable, index, states, {
        pick: (next) => { index = next; build(); },
        // 라인업 요약은 모든 제품의 조절값을 함께 보므로, 다른 제품을 바꾸면 여기도 다시 그려야 한다.
        refreshAll: () => build(),
      }),
    );
  };
  build();
  return mount;
}

/** 확정 설계가 실제로 쓴 값 — 슬라이더의 출발점이자 비교 기준. */
function baseValuesOf(design) {
  return {
    posThickness: parseT(design.posThickness),
    negThickness: parseT(design.negThickness),
    posActiveWeight: design.posActiveWeight,
    plateCount: design.plateCount,
  };
}
const parseT = (text) => Number.parseFloat(String(text).replace(/[^0-9.]/g, '')) || 0.7;

/** 조절값이 기준값과 하나라도 다른 제품 수. "지금 무엇을 만지고 있는지"를 알려준다. */
function tunedCount(tunable, states) {
  return tunable.filter((design) => {
    const base = baseValuesOf(design);
    const now = states.get(design.spec.uid);
    return Object.keys(base).some((key) => Math.abs(now[key] - base[key]) > 1e-9);
  }).length;
}

/** 라인업 연간 납 소요량(톤). 대당 납중량 × 연간 물량. */
const leadTons = (aggregated) =>
  aggregated.designs.reduce((sum, d) => sum + (d.predictedLead || 0) * (d.spec.annualVolume || 0), 0) / 1000;

/** 4개 목표를 모두 만족하는 제품 수. */
const passCount = (aggregated) =>
  aggregated.designs.filter(
    (d) => d.compatibility.valid && ['c20Margin', 'rcMargin', 'ccaMargin', 'saeMargin'].every((k) => (d[k] ?? -1) >= 0),
  ).length;

/**
 * @param {object} ctx
 * @param {object} plan     현재 선택안
 * @param {object[]} tunable 조절 가능한 설계 목록
 * @param {number} index     지금 보고 있는 제품의 위치
 * @param {Map<string,object>} states 제품 uid → 조절값 (카드 바깥에서 유지된다)
 * @param {{pick:(i:number)=>void, refreshAll:()=>void}} on
 */
function designCard(ctx, plan, tunable, index, states, on) {
  const { engine, project } = ctx;
  const baseline = tunable[index];
  const onPick = on.pick;
  const spec = project.lineup.find((item) => item.uid === baseline.spec.uid) || baseline.spec;
  const baseValues = baseValuesOf(baseline);
  const basePosT = baseValues.posThickness;
  const baseNegT = baseValues.negThickness;
  const state = states.get(baseline.spec.uid);

  /**
   * 비교 기준선.
   *
   * 확정 설계가 기준품 실측값을 그대로 쓴 경우(3안에서 기준품을 직접 지정), 조절을 시작하는 순간
   * 계산이 실측 → 모델로 넘어간다. 그 차이를 "조절 때문에 생긴 변화"로 보여주면 거짓말이 된다.
   * 그래서 기준값 자체도 같은 모델로 한 번 돌려 두고, 변화량은 모델끼리만 비교한다.
   */
  const modelBase = engine.calculateDesign(spec, plan.kind, baseline.reference, project.assumptions, baseValues);
  const measuredBaseline = baseline.leadSource === '실측' || !baseline.leadBreakdown;

  /**
   * 라인업 기준선. 모든 제품을 "확정 설계값"으로 놓고 같은 집계를 한 번 돌린 것이다.
   * 제품 단위와 같은 이유로 모델 축을 맞춰야 변화량이 조절 때문이라고 말할 수 있다.
   */
  const lineupBase = engine.retunePlan(
    plan,
    project.lineup,
    project.objective,
    project.assumptions,
    Object.fromEntries(tunable.map((d) => [d.spec.uid, baseValuesOf(d)])),
  );

  const body = h('div.whatif-body');
  const resetButton = h(
    'button.link-button',
    { type: 'button', onclick: () => { Object.assign(state, baseValues); syncControls(); render(); } },
    '기준값으로 되돌리기',
  );

  const controls = [];
  function slider({ key, label, unit, min, max, step, digits }) {
    const input = h('input.whatif-range', {
      type: 'range',
      min, max, step,
      value: state[key],
      'aria-label': label,
      oninput: (event) => {
        state[key] = Number(event.target.value);
        render();
      },
    });
    const readout = h('b.whatif-value');
    const baseText = h('small.whatif-base');
    const update = () => {
      input.value = state[key];
      readout.textContent = `${num(state[key], digits)}${unit}`;
      const baseValue = baseValues[key];
      const d = deltaText(state[key], baseValue, digits, unit);
      baseText.textContent = `기준 ${num(baseValue, digits)}${unit}${d && d.tone !== 'same' ? ` · ${d.text}` : ''}`;
      baseText.className = `whatif-base ${d ? d.tone : ''}`;
    };
    controls.push(update);
    return h(
      'label.whatif-control',
      null,
      h('span.whatif-label', null, label, readout),
      input,
      baseText,
    );
  }
  const syncControls = () => controls.forEach((fn) => fn());

  const activeRange = baseline.posActiveRange || [0, 0];
  const plateRange = baseline.dbPlateRange || [7, 30];

  const panel = h(
    'div.whatif-controls',
    null,
    slider({ key: 'posThickness', label: '양극 기판두께', unit: 'T', min: THICKNESS_MIN, max: THICKNESS_MAX, step: THICKNESS_STEP, digits: 2 }),
    slider({ key: 'negThickness', label: '음극 기판두께', unit: 'T', min: THICKNESS_MIN, max: THICKNESS_MAX, step: THICKNESS_STEP, digits: 2 }),
    slider({
      key: 'posActiveWeight',
      label: '양극 활물질',
      unit: ' g/매',
      min: Math.max(10, Math.floor((activeRange[0] || 40) * 0.7)),
      max: Math.ceil((activeRange[1] || 120) * 1.3),
      step: 0.5,
      digits: 1,
    }),
    slider({
      key: 'plateCount',
      label: '조립매수',
      unit: '매',
      min: Math.max(5, (plateRange[0] || 7) - 3),
      max: (plateRange[1] || 20) + 4,
      step: 1,
      digits: 0,
    }),
  );

  /* ---------------- 계산 · 표시 ---------------- */

  function render() {
    const tuned = engine.calculateDesign(spec, plan.kind, baseline.reference, project.assumptions, {
      posThickness: state.posThickness,
      negThickness: state.negThickness,
      posActiveWeight: state.posActiveWeight,
      plateCount: state.plateCount,
    });
    syncControls();

    const metricRow = (label, nowValue, baseValue, marginValue, unit, digits = 0) => {
      const d = deltaText(nowValue, baseValue, digits, unit);
      return h(
        'tr',
        null,
        h('th', null, label),
        h('td.right', null, `${num(nowValue, digits)}${unit}`),
        h('td.right', null, h('span', { class: `margin-chip ${marginClass(marginValue)}` }, margin(marginValue))),
        h('td.right', null, h('span', { class: `whatif-delta ${d ? d.tone : ''}` }, d ? d.text : '—')),
        h('td.right.whatif-baseline', null, `${num(baseValue, digits)}${unit}`),
      );
    };

    const leadDelta = deltaText(tuned.predictedLead, modelBase.predictedLead, 2, ' kg');
    const costDelta = deltaText(tuned.unitCost, modelBase.unitCost, 0, '원');

    const warnings = [];
    if (state.posActiveWeight > activeRange[1]) {
      warnings.push(`활물질 ${num(state.posActiveWeight, 1)} g/매는 같은 크기 극판 실적 상한 ${num(activeRange[1], 1)} g/매를 넘습니다.`);
    }
    if (state.posActiveWeight < activeRange[0]) {
      warnings.push(`활물질 ${num(state.posActiveWeight, 1)} g/매는 실적 하한 ${num(activeRange[0], 1)} g/매보다 낮습니다.`);
    }
    if (state.plateCount < plateRange[0] || state.plateCount > plateRange[1]) {
      warnings.push(`${state.plateCount}매는 DB 실적 매수범위 ${plateRange[0]}–${plateRange[1]}매 밖입니다. 예측 근거가 없습니다.`);
    }
    if (state.plateCount > spec.maxPlates) {
      warnings.push(`${state.plateCount}매는 입력한 최대 허용매수 ${spec.maxPlates}매를 넘습니다.`);
    }
    const outsidePos = Math.abs(state.posThickness - basePosT) > 1e-9;
    const outsideNeg = Math.abs(state.negThickness - baseNegT) > 1e-9;
    if (outsidePos || outsideNeg) {
      warnings.push('기판두께를 바꾸면 그 두께의 극판이 실제로 존재하는지(또는 만들 수 있는지) 확인이 필요합니다.');
    }

    // 라인업 전체 — 지금 화면의 제품만이 아니라 조절된 모든 제품을 반영한다.
    const lineupNow = engine.retunePlan(
      plan,
      project.lineup,
      project.objective,
      project.assumptions,
      Object.fromEntries([...states.entries()]),
    );
    const changed = tunedCount(tunable, states);

    const lineupRow = (label, nowValue, baseValue, format, digits, unit) => {
      const d = deltaText(nowValue, baseValue, digits, unit);
      return h(
        'tr',
        null,
        h('th', null, label),
        h('td.right', null, format(nowValue)),
        h('td.right', null, h('span', { class: `whatif-delta ${d ? d.tone : ''}` }, d ? d.text : '—')),
        h('td.right.whatif-baseline', null, format(baseValue)),
      );
    };

    const lineupSummary = h(
      'div.whatif-lineup',
      null,
      h('h4', null, `라인업 전체 (제품 ${tunable.length}개${changed ? ` · 조절 중 ${changed}개` : ''})`),
      h(
        'div.table-scroll',
        null,
        h(
          'table.data-table.whatif-table',
          null,
          h('thead', null, h('tr', null,
            h('th', null, '라인업 항목'), h('th.right', null, '조절 결과'),
            h('th.right', null, '변화'), h('th.right', null, '기준값'))),
          h(
            'tbody',
            null,
            lineupRow('가중 평균원가', lineupNow.averageCost, lineupBase.averageCost, won, 0, '원'),
            lineupRow('목표 충족 제품', passCount(lineupNow), passCount(lineupBase), (v) => `${v} / ${tunable.length}개`, 0, '개'),
            lineupRow('연간 납 소요량', leadTons(lineupNow), leadTons(lineupBase), (v) => `${num(v, 1)} 톤`, 1, ' 톤'),
            lineupRow('공용 극판군', lineupNow.commonFamilies, lineupBase.commonFamilies, (v) => `${v}개`, 0, '개'),
            lineupRow('개발 투자', lineupNow.developmentCost, lineupBase.developmentCost, eok, 0, '원'),
          ),
        ),
      ),
      h('p.card-note', null,
        '제품 하나만 조절해도 라인업 숫자는 함께 움직입니다 — 대당 원가가 연간 물량으로 가중되므로 '
        + '물량이 큰 제품일수록 크게 움직입니다. 제품을 바꿔가며 조절하면 조절값은 제품마다 그대로 남습니다.'),
    );

    body.replaceChildren(...[
      h(
        'div.table-scroll',
        null,
        h(
          'table.data-table.whatif-table',
          null,
          h('thead', null, h('tr', null,
            h('th', null, '항목'), h('th.right', null, '조절 결과'), h('th.right', null, '목표여유'),
            h('th.right', null, '변화'), h('th.right', null, '기준값'))),
          h(
            'tbody',
            null,
            metricRow('C20 용량', tuned.predictedC20, modelBase.predictedC20, tuned.c20Margin, ' Ah', 1),
            metricRow('RC', tuned.predictedRc, modelBase.predictedRc, tuned.rcMargin, ' 분'),
            metricRow('EN CCA', tuned.predictedEnCca, modelBase.predictedEnCca, tuned.ccaMargin, ' A'),
            metricRow('SAE CCA', tuned.predictedSaeCca, modelBase.predictedSaeCca, tuned.saeMargin, ' A'),
            h('tr.whatif-sep', null,
              h('th', null, '납중량'),
              h('td.right', null, h('div.cell-stack', null,
                h('strong', null, `${num(tuned.predictedLead, 2)} kg`),
                tuned.leadBreakdown
                  ? h('small', null, `기판 ${num(tuned.leadBreakdown.grid, 2)} · 활물질 ${num(tuned.leadBreakdown.active, 2)} · COS ${num(tuned.leadBreakdown.cos, 2)}`)
                  : h('small', null, '실측값'))),
              h('td.right', null, ''),
              h('td.right', null, h('span', { class: `whatif-delta ${leadDelta ? leadDelta.tone : ''}` }, leadDelta ? leadDelta.text : '—')),
              h('td.right.whatif-baseline', null, `${num(modelBase.predictedLead, 2)} kg`)),
            h('tr', null,
              h('th', null, '대당 원가'),
              h('td.right', null, won(tuned.unitCost)),
              h('td.right', null, ''),
              h('td.right', null, h('span', { class: `whatif-delta ${costDelta ? costDelta.tone : ''}` }, costDelta ? costDelta.text : '—')),
              h('td.right.whatif-baseline', null, won(modelBase.unitCost))),
            h('tr', null,
              h('th', null, '극판'),
              h('td.right', null, `${tuned.posCount}+ / ${tuned.negCount}−`),
              h('td.right', null, ''),
              h('td.right', null, ''),
              h('td.right.whatif-baseline', null, `${modelBase.posCount}+ / ${modelBase.negCount}−`)),
          ),
        ),
      ),
      lineupSummary,
      warnings.length ? notice('warn', warnings.join(' ')) : null,
      measuredBaseline
        ? notice(
            'info',
            `확정 설계는 기준품 ${baseline.reference.code} 의 실측값(납 ${num(baseline.predictedLead, 2)} kg, C20 ${num(baseline.predictedC20, 1)} Ah)을 그대로 쓰고 있습니다. `
              + '조절을 하면 실측이 아니라 모델로 계산되므로, 위 「기준값」 열은 같은 조건을 모델로 다시 계산한 값입니다. 변화량은 모델끼리 비교한 결과입니다.',
          )
        : null,
    ].filter(Boolean));
  }

  syncControls();
  render();

  return h(
    'section.card.whatif-card',
    null,
    h(
      'header.card-head',
      null,
      h(
        'div',
        null,
        h('h3', null, icon('target', 16), ' 실시간 설계 조절'),
        h('p.card-note', null, `${baseline.spec.name} · ${plan.shortLabel} — 슬라이더를 움직이면 성능·납중량·원가가 바로 다시 계산됩니다.`),
      ),
      h(
        'div.card-tools',
        null,
        tunable.length > 1 &&
          h(
            'select.whatif-pick',
            {
              'aria-label': '조절할 제품',
              value: String(index),
              onchange: (event) => onPick(Number(event.target.value)),
            },
            ...tunable.map((d, i) =>
              h('option', { value: String(i), selected: i === index }, `${d.spec.name} · ${d.spec.group}`),
            ),
          ),
        resetButton,
      ),
    ),
    panel,
    body,
    h(
      'p.card-note',
      null,
      '여기서 바꾼 값은 ',
      h('b', null, '저장되지 않습니다'),
      '. 검토용 탐색이며, 확정하려면 요구사양을 바꿔 정식으로 다시 계산하세요. 기판두께는 근사 모델(CCA 두께계수 −14%~+4%)을 거치므로 시제품 검증이 필요합니다.',
    ),
  );
}
