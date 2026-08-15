/**
 * src/views/design.js — 설계안 3종 비교와 선택안의 극판 BOM.
 */
import { h, icon, table } from '../lib/dom.js';
import { num, won, eok, pct, margin, meetsAllTargets, GRADE_NOTE } from '../core/format.js';
import { downloadCsv, downloadXlsx } from '../core/export.js';
import { sectionHead, stepNav, marginChip, gradeChip, notice } from './parts.js';
import { whatIfCard } from './whatif.js';

export function renderDesign(ctx) {
  const { project, plans } = ctx;
  if (!plans) {
    return h(
      'div.view',
      null,
      sectionHead({ eyebrow: 'DESIGN', title: '설계·BOM·공용화' }),
      notice('error', '아직 계산된 설계안이 없습니다. 요구사양 입력을 완성한 뒤 계산하세요.'),
      h('button.primary-button', { type: 'button', onclick: () => ctx.goto('requirements') }, '요구사양으로 이동'),
    );
  }

  const ranking = ctx.engine.rankPlans(plans, project.objective);
  const rankOf = (kind) => ranking.find((r) => r.kind === kind);
  const selected = ctx.selectedPlan;
  const cheapest = Math.min(...plans.map((p) => p.averageCost));

  return h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'DESIGN',
      title: '설계안 비교와 극판 BOM',
      description: '가격만 보지 않고 목표충족·공용화·개발투자·근거등급을 함께 비교합니다.',
      actions: [
        h('button.secondary-button', { type: 'button', onclick: () => exportPlanComparison(ctx, plans, ranking) }, icon('download', 15), ' 3개안 비교 CSV'),
        h('button.secondary-button', { type: 'button', onclick: () => exportBom(ctx, selected) }, icon('download', 15), ' 설계 BOM Excel'),
      ],
    }),

    h('p.decision-basis', null, `판단 기준: ${ranking[0].decisionBasis}`),

    h(
      'div.plan-grid',
      null,
      ...plans.map((plan) => planCard(ctx, plan, rankOf(plan.kind), plan.kind === selected.kind, plan.averageCost === cheapest)),
    ),

    planDetail(ctx, selected),

    whatIfCard(ctx, selected),

    stepNav(ctx, {
      back: { view: 'matching', label: '매칭으로' },
      next: 'costing',
      nextLabel: '원가·수익성으로 이동',
    }),
  );
}

function planCard(ctx, plan, rank, selected, cheapest) {
  return h(
    'button',
    {
      type: 'button',
      class: `plan-card ${selected ? 'selected' : ''}`,
      'aria-pressed': String(selected),
      onclick: () => ctx.selectPlan(plan.kind),
    },
    h(
      'div.plan-topline',
      null,
      h(`span.plan-index.${plan.kind}`, null, plan.kind === 'new' ? '01' : plan.kind === 'hybrid' ? '02' : '03'),
      h(
        'div.plan-tags',
        null,
        h('span.rank-tag', null, `비교 ${rank.rank}위`),
        rank.rank === 1 && h('span.recommend-tag', null, '현재 관점 우선안'),
        cheapest && h('span.cost-tag', null, '최저 원가'),
      ),
    ),
    h('h3', null, plan.label),
    h('p', null, plan.description),
    h(
      'div.plan-kpis',
      null,
      planKpi('가중 평균원가', won(plan.averageCost)),
      planKpi('개발 투자', eok(plan.developmentCost)),
      planKpi('목표 충족', `${rank.passCount}/${rank.totalProducts}개`),
      planKpi('공용 극판군', `${plan.commonFamilies}개`),
      planKpi('공용화율', pct(plan.commonization)),
      planKpi('개발 기간', `${plan.developmentMonths}개월`),
    ),
    h(
      'div.plan-foot',
      null,
      h('span', { class: `risk-chip ${plan.risk === '높음' ? 'high' : plan.risk === '보통' ? 'mid' : 'low'}` }, `위험 ${plan.risk}`),
      h('small', null, `최저 성능여유 ${margin(rank.worstMargin)}`),
    ),
  );
}

const planKpi = (label, value) => h('div', null, h('span', null, label), h('strong', null, value));

function planDetail(ctx, plan) {
  const { engine } = ctx;
  const failing = plan.designs.filter((d) => !meetsAllTargets(d));

  return h(
    'section.card',
    null,
    h(
      'header.card-head',
      null,
      h('div', null, h('h3', null, `${plan.label} · 극판 BOM`), h('p.card-note', null, plan.description)),
      h('span.plan-score', null, `종합점수 ${plan.score}`),
    ),

    failing.length
      ? notice(
          'error',
          `${failing.length}개 제품이 목표를 충족하지 못했습니다: ${failing.map((d) => d.spec.name).join(', ')}`,
        )
      : notice('info', '모든 제품이 4개 성능 목표와 매수 조건을 충족했습니다.'),

    table(
      [
        { label: '제품', format: (d) => h('div.cell-stack', null, h('strong', null, d.spec.name), h('small', null, d.spec.group)) },
        { label: '기준품', format: (d) => (d.compatibility.valid ? d.reference.code : '—') },
        {
          label: '매수',
          align: 'right',
          format: (d) => h('div.cell-stack', null, h('strong', null, `${d.plateCount}매`), h('small', null, `+${d.posCount} / −${d.negCount}`)),
        },
        {
          label: '극판 조합',
          format: (d) => h('div.cell-stack', null, h('strong', null, d.posCode), h('small', null, d.negCode)),
        },
        { label: '활물질', align: 'right', format: (d) => (d.posActiveWeight ? `${num(d.posActiveWeight, 1)} g/매` : '—') },
        {
          label: '예측 성능',
          format: (d) =>
            h(
              'div.cell-stack',
              null,
              h('span', null, `C20 ${num(d.predictedC20, 1)}Ah · RC ${num(d.predictedRc)}분`),
              h('small', null, `EN ${num(d.predictedEnCca)}A · SAE ${num(d.predictedSaeCca)}A`),
            ),
        },
        {
          label: '성능여유',
          format: (d) =>
            h(
              'div.margin-row',
              null,
              marginChip('C20', d.c20Margin),
              marginChip('RC', d.rcMargin),
              marginChip('EN', d.ccaMargin),
              marginChip('SAE', d.saeMargin),
            ),
        },
        { label: '대당 원가', align: 'right', format: (d) => won(d.unitCost) },
        {
          label: '근거',
          format: (d) => h('div.cell-stack', null, gradeChip(d.evidenceGrade), h('small', null, `신뢰 ${d.confidence}`)),
        },
      ],
      plan.designs,
      { rowClass: (d) => (meetsAllTargets(d) ? null : 'row-fail') },
    ),

    h(
      'details.reason-block',
      null,
      h('summary', null, '설계 선택 근거와 경고 (제품별)'),
      ...plan.designs.map((d) =>
        h(
          'div.reason-item',
          null,
          h('strong', null, `${d.spec.name} · ${d.spec.group}`),
          h('p', null, d.selectionReason),
          h(
            'small',
            null,
            `DB 실적 매수 ${d.dbPlateRange[0]}–${d.dbPlateRange[1]}매 · 검토 ${d.evaluatedPlateCounts.length}개 · CCA 근거 제품 ${d.ccaEvidenceProducts}건 · 두께계수 ${d.ccaThicknessFactor}`,
          ),
          d.warning && h('p.message-warn', null, d.warning),
          h('p.grade-note', null, `${d.evidenceGrade}등급 — ${GRADE_NOTE[d.evidenceGrade]}`),
        ),
      ),
    ),

    h(
      'div.plan-notes',
      null,
      h('div', null, h('h4', null, '강점'), h('ul', null, plan.strengths.map((s) => h('li', null, s)))),
      h('div', null, h('h4', null, '유의사항'), h('ul', null, plan.cautions.map((s) => h('li', null, s)))),
    ),
  );
}

/* ---------------------------- 내보내기 ---------------------------- */

export function bomRows(plan) {
  return [
    ['제품', '제품군', '설계안', '기준품', '매수', '양극수', '음극수', '셀수', '양극코드', '음극코드', '활물질(g/매)', 'C20(Ah)', 'RC(분)', 'EN CCA(A)', 'SAE CCA(A)', 'C20여유(%)', 'RC여유(%)', 'EN여유(%)', 'SAE여유(%)', '격리판봉합', '봉합근거', '납중량(kg)', '납중량출처', '대당원가(원)', '근거등급', '신뢰지수', '선택사유', '경고'],
    ...plan.designs.map((d) => [
      d.spec.name,
      d.spec.group,
      plan.shortLabel,
      d.compatibility.valid ? d.reference.code : '',
      d.plateCount,
      d.posCount,
      d.negCount,
      d.cellCount,
      d.posCode,
      d.negCode,
      d.posActiveWeight,
      d.predictedC20,
      d.predictedRc,
      d.predictedEnCca,
      d.predictedSaeCca,
      d.c20Margin ?? '목표 미입력',
      d.rcMargin ?? '목표 미입력',
      d.ccaMargin ?? '목표 미입력',
      d.saeMargin ?? '목표 미입력',
      d.separator?.label || '',
      d.separator?.value ? `${d.separator.basis} ${d.separator.agree}/${d.separator.total}` : '',
      d.predictedLead,
      d.leadSource,
      d.unitCost,
      d.evidenceGrade,
      d.confidence,
      d.selectionReason,
      d.warning || '',
    ]),
  ];
}

function exportBom(ctx, plan) {
  downloadXlsx(`${ctx.project.name}-${plan.shortLabel}-설계BOM.xlsx`, '설계BOM', bomRows(plan));
}

function exportPlanComparison(ctx, plans, ranking) {
  const rows = [
    ['설계안', '구분', '순위', '가중평균원가(원)', '개발투자(원)', '개발기간(개월)', '공용극판군', '공용화율(%)', '공용물량비중(%)', '목표충족', '최저성능여유(%)', '종합점수', '위험'],
    ...plans.map((plan) => {
      const rank = ranking.find((r) => r.kind === plan.kind);
      return [
        plan.label,
        plan.shortLabel,
        rank.rank,
        plan.averageCost,
        plan.developmentCost,
        plan.developmentMonths,
        plan.commonFamilies,
        plan.commonization,
        plan.commonizedVolumeShare,
        `${rank.passCount}/${rank.totalProducts}`,
        rank.worstMargin,
        plan.score,
        plan.risk,
      ];
    }),
  ];
  downloadCsv(`${ctx.project.name}-3개안비교.csv`, rows);
}
