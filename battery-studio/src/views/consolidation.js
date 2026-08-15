/**
 * src/views/consolidation.js — 극판군 통합 검토.
 *
 * 답하는 질문은 하나다: <b>극판을 1종 더 만들면 연간 얼마를 버는가.</b>
 *
 * 왜 이 형태인가
 *   · 금형비가 0이면 "몇 개가 최적인가"는 원가만으로 답이 안 나온다. 원가만 보면
 *     극판이 많을수록 항상 유리하기 때문이다. 그래서 최적점을 찍어주는 대신,
 *     한 종을 더할 때의 <b>연간 절감액</b>을 내놓고 부동재고 부담과 견주게 한다.
 *   · 부담 금액을 아는 사람은 도구가 아니라 담당자다. 입력하면 판단까지 해주고,
 *     비워두면 절감액만 보여준다 — 모르는 숫자를 지어내지 않는다.
 *   · 원가가 싸져도 목표를 놓치면 대안이 아니다. 목표 충족 수를 같은 줄에 둔다.
 */
import { h, icon } from '../lib/dom.js';
import { num, won } from '../core/format.js';
import { notice } from './parts.js';

/** 연간 금액을 억 단위로. 라인업 총원가는 억 단위로 보는 것이 실무 감각에 맞다. */
const eokOf = (value) => `${num(value / 100000000, 2)}억원`;

/** 부담 금액처럼 작을 수도 큰 수도 있는 값. 1억 미만은 원 단위가 읽기 쉽다. */
const moneyOf = (value) => (Math.abs(value) >= 100000000 ? eokOf(value) : won(value));

export function consolidationCard(ctx, plan) {
  const { engine, project } = ctx;
  const curve = engine.consolidationCurve(
    project.lineup,
    plan.kind,
    project.objective,
    project.assumptions,
  );

  if (curve.length < 2) {
    // 선택지가 없으면 표를 만들 이유도 없다. 왜 없는지만 알려준다.
    return h(
      'section.card.consol-card',
      null,
      cardHead(plan),
      notice(
        'info',
        curve.length === 1
          ? `${plan.shortLabel}에서 이 라인업이 쓸 수 있는 극판군은 ${curve[0].familyCount}개뿐입니다. 나눌 선택지가 없어 검토할 것이 없습니다.`
          : '이 라인업에서는 극판군을 나눌 선택지가 없습니다. (제품이 1개이거나 호환 극판이 없습니다)',
      ),
    );
  }

  const burden = Number(project.assumptions.inventoryBurdenPerFamily) || 0;
  /**
   * 추천 지점: 절감액이 부담보다 큰 마지막 지점.
   * 절감액은 극판군이 늘수록 줄어들므로, 한 번 뒤집히면 그 뒤로도 계속 손해다.
   */
  let recommended = curve[0];
  if (burden > 0) {
    for (const point of curve.slice(1)) {
      if (point.marginalSaving <= burden) break;
      recommended = point;
    }
  }

  const rows = curve.map((point, index) => {
    const isFirst = index === 0;
    const worthIt = burden > 0 && !isFirst && point.marginalSaving > burden;
    const isRecommended = burden > 0 && point === recommended;
    const missed = point.totalProducts - point.passCount;

    return h(
      'tr',
      { class: isRecommended ? 'consol-pick' : '' },
      h('th', null, h('div.cell-stack', null,
        h('strong', null, `${point.familyCount}종`),
        h('small', null, isFirst ? '현재 안 (최대 통합)' : `+${point.familyCount - curve[0].familyCount}종`))),
      h('td.right', null, won(point.plan.averageCost)),
      h('td.right', null, eokOf(point.annualCost)),
      h('td.right', null, isFirst
        ? h('small.muted-cell', null, '기준')
        : h('b.consol-saving', null, `−${eokOf(point.marginalSaving)}`)),
      h('td.right', null, missed
        ? h('span.margin-chip.fail', null, `${point.passCount}/${point.totalProducts}`)
        : h('span.margin-chip.pass', null, `${point.passCount}/${point.totalProducts}`)),
      h('td', null, isFirst
        ? ''
        : burden > 0
          ? h('span', { class: `consol-verdict ${worthIt ? 'yes' : 'no'}` }, worthIt ? '만들 값어치 있음' : '부담이 더 큼')
          : h('small.muted-cell', null, `연 ${eokOf(point.marginalSaving)} vs 부동재고 부담`)),
    );
  });

  const best = curve[curve.length - 1];
  const firstStep = curve[1];

  return h(
    'section.card.consol-card',
    null,
    cardHead(plan),

    h(
      'div.table-scroll',
      null,
      h(
        'table.data-table.consol-table',
        null,
        h('thead', null, h('tr', null,
          h('th', null, '극판군'),
          h('th.right', null, '가중 평균원가'),
          h('th.right', null, '연간 총원가'),
          h('th.right', null, '직전 대비 절감'),
          h('th.right', null, '목표 충족'),
          h('th', null, burden > 0 ? `판단 (부담 연 ${moneyOf(burden)}/종)` : '판단'))),
        h('tbody', null, ...rows),
      ),
    ),

    burden > 0
      ? notice(
          'info',
          `극판 1종당 부동재고 부담을 연 ${moneyOf(burden)}으로 보면 ${recommended.familyCount}종이 유리합니다. `
            + `현재 안(${curve[0].familyCount}종)보다 연 ${eokOf(curve[0].annualCost - recommended.annualCost)} 아낍니다. `
            + '부담 금액은 요구사양 → 원가 가정에서 바꿀 수 있습니다.',
        )
      : notice(
          'info',
          `극판 1종당 부동재고 부담을 요구사양 → 원가 가정에 넣으면 어디까지 만드는 것이 유리한지 표시해 드립니다. `
            + `넣지 않으면 절감액만 보여드립니다 — 부담 금액은 도구가 알 수 없기 때문입니다.`,
        ),

    h(
      'details.reason-block',
      null,
      h('summary', null, '각 지점에서 제품이 어느 극판군을 쓰는지'),
      ...curve.map((point) =>
        h(
          'div.reason-item',
          null,
          h('strong', null, `극판군 ${point.familyCount}종`),
          h('ul', null, ...point.families.map((key) => {
            const users = point.plan.designs.filter((d) => d.compatibility.familyKey === key);
            const label = users[0] ? users[0].compatibility.familyLabel : key;
            const volume = users.reduce((sum, d) => sum + (d.spec.annualVolume || 0), 0);
            return h('li', null,
              h('b', null, label),
              ` — ${users.map((d) => d.spec.name).join(', ')} (연 ${num(volume)}대)`);
          })),
        ),
      ),
    ),

    h(
      'p.card-note',
      null,
      '아래에서 위로 읽으세요. ',
      h('b', null, `${curve[0].familyCount}종 → ${firstStep.familyCount}종은 연 ${eokOf(firstStep.marginalSaving)}`),
      firstStep === best
        ? ' 을 아낍니다. '
        : `, 끝까지 나누면(${best.familyCount}종) 현재 안 대비 연 ${eokOf(curve[0].annualCost - best.annualCost)} 을 아낍니다. `,
      '절감액이 극판 1종을 더 운용하는 부담보다 크면 만드는 것이 맞습니다. '
        + '통합 범위는 그 제품군 실적에 등록된 극판만 씁니다 — 제품군을 넘는 강제 공용은 하지 않습니다.',
    ),
  );
}

const cardHead = (plan) =>
  h(
    'header.card-head',
    null,
    h(
      'div',
      null,
      h('h3', null, icon('layers', 16), ' 극판군 통합 검토'),
      h('p.card-note', null, `${plan.label} — 극판을 1종 더 만들면 연간 얼마를 버는지 계산합니다.`),
    ),
  );
