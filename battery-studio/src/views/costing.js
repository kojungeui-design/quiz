/**
 * src/views/costing.js — 원가·수익성 1차 검토.
 * 여기 숫자는 극판 재료비와 조립비 중심의 설계 비교값이다. 견적서가 아니다.
 */
import { h, table } from '../lib/dom.js';
import { num, won, eok, pct } from '../core/format.js';
import { sectionHead, stepNav, numberField, notice } from './parts.js';

export function renderCosting(ctx) {
  const { project, plans } = ctx;
  if (!plans) {
    return h(
      'div.view',
      null,
      sectionHead({ eyebrow: 'COSTING', title: '원가·수익성' }),
      notice('error', '계산된 설계안이 없습니다. 요구사양을 완성한 뒤 계산하세요.'),
      h('button.primary-button', { type: 'button', onclick: () => ctx.goto('requirements') }, '요구사양으로 이동'),
    );
  }

  const plan = ctx.selectedPlan;
  // 판매 가정은 과제에 저장한다(다시 열었을 때 그대로 남도록).
  const sales = project.salesAssumptions || { unitPrice: 0, sgaRate: 8, warrantyRate: 1.5 };
  if (!project.salesAssumptions) {
    // 판매단가 초기값은 원가에 20% 얹은 값으로 제안한다.
    sales.unitPrice = Math.round((plan.averageCost * 1.2) / 100) * 100;
  }

  const results = h('div.costing-results');
  const recompute = () => results.replaceChildren(...profitBlocks(ctx, plan, sales));

  const patchSales = (changes) => {
    Object.assign(sales, changes);
    ctx.patchProject({ salesAssumptions: { ...sales } });
    recompute();
  };

  const view = h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'COSTING',
      title: '원가·수익성 분석',
      description: `${plan.label} 기준입니다. 설계안을 바꾸려면 설계·BOM 화면에서 선택하세요.`,
    }),

    notice(
      'info',
      '이 원가는 극판 재료비·조립비 중심의 설계 비교값입니다. 실제 견적에는 케이스·분리판·전해액·물류·환율·보증조건이 추가되어야 합니다.',
    ),

    h(
      'section.card',
      null,
      h('h3', null, '판매 가정'),
      h(
        'div.field-grid.three',
        null,
        numberField({
          label: '평균 판매단가',
          unit: '원/대',
          value: sales.unitPrice,
          min: 0,
          step: 1000,
          onInput: (v) => patchSales({ unitPrice: v }),
        }),
        numberField({
          label: '판관비율',
          unit: '%',
          value: sales.sgaRate,
          min: 0,
          max: 60,
          step: 0.5,
          onInput: (v) => patchSales({ sgaRate: v }),
        }),
        numberField({
          label: '보증충당률',
          unit: '%',
          value: sales.warrantyRate,
          min: 0,
          max: 30,
          step: 0.1,
          onInput: (v) => patchSales({ warrantyRate: v }),
        }),
      ),
    ),

    results,

    h(
      'section.card',
      null,
      h('h3', null, '제품별 원가'),
      table(
        [
          { label: '제품', format: (d) => h('div.cell-stack', null, h('strong', null, d.spec.name), h('small', null, d.spec.group)) },
          { label: '극판군', format: (d) => d.compatibility.familyLabel },
          { label: '매수', align: 'right', format: (d) => `${d.plateCount}매 × ${d.cellCount}셀` },
          { label: '연간수량', align: 'right', format: (d) => `${num(d.spec.annualVolume)}대` },
          { label: '대당 원가', align: 'right', format: (d) => won(d.unitCost) },
          {
            label: '연간 원가',
            align: 'right',
            format: (d) => eok(d.unitCost * d.spec.annualVolume),
          },
          {
            label: '대당 공헌이익',
            align: 'right',
            format: (d) => {
              const contribution = contributionPerUnit(d.unitCost, sales);
              return h('span', { class: contribution >= 0 ? 'positive' : 'negative' }, won(contribution));
            },
          },
        ],
        plan.designs,
      ),
    ),

    stepNav(ctx, { back: { view: 'design', label: '설계·BOM으로' }, next: 'report', nextLabel: '보고서로 이동' }),
  );

  recompute();
  return view;
}

const contributionPerUnit = (unitCost, sales) =>
  sales.unitPrice - unitCost - sales.unitPrice * (sales.sgaRate / 100) - sales.unitPrice * (sales.warrantyRate / 100);

function profitBlocks(ctx, plan, sales) {
  const totalVolume = plan.designs.reduce((sum, d) => sum + d.spec.annualVolume, 0);
  const totalCost = plan.designs.reduce((sum, d) => sum + d.unitCost * d.spec.annualVolume, 0);
  const totalRevenue = sales.unitPrice * totalVolume;
  const totalContribution = plan.designs.reduce((sum, d) => sum + contributionPerUnit(d.unitCost, sales) * d.spec.annualVolume, 0);
  const marginRate = totalRevenue > 0 ? (totalContribution / totalRevenue) * 100 : null;
  const paybackYears = totalContribution > 0 ? plan.developmentCost / totalContribution : null;

  return [
    h(
      'div.kpi-row',
      null,
      kpiCard('연간 매출', eok(totalRevenue), `${num(totalVolume)}대 기준`),
      kpiCard('연간 원가', eok(totalCost), `대당 평균 ${won(plan.averageCost)}`),
      kpiCard('연간 공헌이익', eok(totalContribution), marginRate === null ? '판매단가 입력 필요' : `공헌이익률 ${pct(marginRate, 1)}`),
      kpiCard(
        '개발투자 회수',
        paybackYears === null ? '회수 불가' : paybackYears < 0.1 ? '즉시' : `${num(paybackYears, 1)}년`,
        `투자 ${eok(plan.developmentCost)}`,
      ),
    ),
    totalContribution <= 0 && sales.unitPrice > 0
      ? notice('error', '현재 판매단가로는 공헌이익이 나지 않습니다. 단가나 설계안을 다시 검토하세요.')
      : null,
    paybackYears !== null && paybackYears > 3
      ? notice('error', `개발투자 회수에 ${num(paybackYears, 1)}년이 걸립니다. 공용화를 높이거나 투자 규모를 재검토하세요.`)
      : null,
  ].filter(Boolean);
}

const kpiCard = (label, value, note) => h('div.kpi', null, h('span', null, label), h('strong', null, value), h('small', null, note));
