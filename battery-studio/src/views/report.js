/**
 * src/views/report.js — 종합보고서와 내보내기.
 * 인쇄하면 사이드바·버튼이 빠지고 이 화면만 문서로 남는다(app.css의 @media print).
 */
import { h, icon, table } from '../lib/dom.js';
import { num, won, eok, pct, margin, dateLabel, meetsAllTargets, STATUS_LABEL, OBJECTIVE_LABEL, GRADE_NOTE } from '../core/format.js';
import { downloadCsv, downloadXlsx, printPage } from '../core/export.js';
import { bomRows } from './design.js';
import { sectionHead, stepNav, gradeChip, notice } from './parts.js';
import { ENGINE_VERSION } from '../core/project.js';

export function renderReport(ctx) {
  const { project, plans, engine } = ctx;
  if (!plans) {
    return h(
      'div.view',
      null,
      sectionHead({ eyebrow: 'REPORT', title: '분석보고서' }),
      notice('error', '계산된 설계안이 없습니다.'),
      h('button.primary-button', { type: 'button', onclick: () => ctx.goto('requirements') }, '요구사양으로 이동'),
    );
  }

  const plan = ctx.selectedPlan;
  const ranking = engine.rankPlans(plans, project.objective);
  const rank = ranking.find((r) => r.kind === plan.kind);
  const failing = plan.designs.filter((d) => !meetsAllTargets(d));
  const lowGrade = plan.designs.filter((d) => d.evidenceGrade === 'D');

  return h(
    'div.view.report-view',
    null,
    sectionHead({
      eyebrow: 'REPORT',
      title: '분석보고서 · 출력',
      description: '요구사양부터 설계 BOM, 3개안 비교까지 같은 버전으로 출력합니다.',
      actions: [
        h('button.secondary-button', { type: 'button', onclick: () => exportRequirements(ctx) }, icon('download', 15), ' 요구사양 CSV'),
        h('button.secondary-button', { type: 'button', onclick: () => downloadXlsx(`${project.name}-설계BOM.xlsx`, '설계BOM', bomRows(plan)) }, icon('download', 15), ' 설계 BOM Excel'),
        h('button.primary-button', { type: 'button', onclick: printPage }, icon('printer', 15), ' 인쇄 / PDF 저장'),
      ],
    }),

    h(
      'section.card.report-doc',
      null,
      h(
        'header.report-head',
        null,
        h('div', null, h('h1', null, project.name), h('p', null, `${project.customer || '고객 미지정'} · ${project.requestNo || '요청번호 없음'}`)),
        h(
          'dl.report-meta',
          null,
          meta('단계', STATUS_LABEL[project.status]),
          meta('비교 관점', OBJECTIVE_LABEL[project.objective]),
          meta('담당', project.owner || '—'),
          meta('작성', dateLabel(project.updatedAt)),
          meta('엔진', ENGINE_VERSION),
          meta('데이터', engine.meta?.sourceBuild || '—'),
        ),
      ),

      h('h3', null, '1. 결론'),
      h(
        'p.report-lead',
        null,
        `${plan.label}을(를) 선택안으로 제시합니다. ${project.lineup.length}개 제품 중 ${rank.passCount}개가 4개 성능 목표를 모두 충족하며, `,
        `가중 평균원가 ${won(plan.averageCost)}, 개발 투자 ${eok(plan.developmentCost)}, 공용 극판군 ${plan.commonFamilies}개(공용화율 ${pct(plan.commonization)})입니다.`,
      ),
      failing.length
        ? notice('error', `미충족 ${failing.length}건: ${failing.map((d) => `${d.spec.name}(${firstShortfall(d)})`).join(', ')}`)
        : notice('info', '모든 제품이 목표를 충족했습니다.'),
      lowGrade.length ? notice('error', `근거 D등급 ${lowGrade.length}건 — ${lowGrade.map((d) => d.spec.name).join(', ')}. 승인 근거로 쓸 수 없습니다.`) : null,

      h('h3', null, '2. 요구사양'),
      table(
        [
          { label: '제품', key: 'name' },
          { label: '제품군', key: 'group' },
          { label: '기술', format: (i) => engine.technologyOf(i.group) },
          { label: 'C20', align: 'right', format: (i) => `${num(i.targetC20, 1)} Ah` },
          { label: 'RC', align: 'right', format: (i) => `${num(i.targetRc)} 분` },
          { label: 'EN CCA', align: 'right', format: (i) => `${num(i.targetEnCca)} A` },
          { label: 'SAE CCA', align: 'right', format: (i) => `${num(i.targetSaeCca)} A` },
          { label: '매수상한', align: 'right', format: (i) => `${i.maxPlates} 매` },
          { label: '셀수', align: 'right', format: (i) => `${i.cellCount} 셀` },
          { label: '연간수량', align: 'right', format: (i) => `${num(i.annualVolume)} 대` },
        ],
        project.lineup,
      ),

      h('h3', null, '3. 설계안 비교'),
      table(
        [
          { label: '설계안', format: (p) => p.label },
          { label: '순위', align: 'right', format: (p) => `${ranking.find((r) => r.kind === p.kind).rank}위` },
          { label: '목표충족', align: 'right', format: (p) => { const r = ranking.find((x) => x.kind === p.kind); return `${r.passCount}/${r.totalProducts}`; } },
          { label: '평균원가', align: 'right', format: (p) => won(p.averageCost) },
          { label: '개발투자', align: 'right', format: (p) => eok(p.developmentCost) },
          { label: '기간', align: 'right', format: (p) => `${p.developmentMonths}개월` },
          { label: '공용화율', align: 'right', format: (p) => pct(p.commonization) },
          { label: '위험', format: (p) => p.risk },
          { label: '점수', align: 'right', format: (p) => p.score },
        ],
        plans,
        { rowClass: (p) => (p.kind === plan.kind ? 'current' : null) },
      ),
      h('p.card-note', null, `판단 기준: ${rank.decisionBasis}`),

      h('h3', null, '4. 선택안 설계 BOM'),
      table(
        [
          { label: '제품', format: (d) => d.spec.name },
          { label: '기준품', format: (d) => (d.compatibility.valid ? d.reference.code : '—') },
          { label: '매수', align: 'right', format: (d) => `${d.plateCount}매` },
          { label: '양극', format: (d) => d.posCode },
          { label: '음극', format: (d) => d.negCode },
          { label: 'C20', align: 'right', format: (d) => `${num(d.predictedC20, 1)} (${margin(d.c20Margin)})` },
          { label: 'RC', align: 'right', format: (d) => `${num(d.predictedRc)} (${margin(d.rcMargin)})` },
          { label: 'EN CCA', align: 'right', format: (d) => `${num(d.predictedEnCca)} (${margin(d.ccaMargin)})` },
          { label: 'SAE CCA', align: 'right', format: (d) => `${num(d.predictedSaeCca)} (${margin(d.saeMargin)})` },
          { label: '원가', align: 'right', format: (d) => won(d.unitCost) },
          { label: '근거', format: (d) => gradeChip(d.evidenceGrade) },
        ],
        plan.designs,
        { rowClass: (d) => (meetsAllTargets(d) ? null : 'row-fail') },
      ),

      h('h3', null, '5. 근거와 한계'),
      h(
        'ul.report-limits',
        null,
        h('li', null, `예측 근거: 사내 실적 제품 ${engine.dbStats.references}건, 극판 마스터 ${engine.dbStats.plates}건 (데이터 ${engine.meta?.sourceBuild || '—'}).`),
        // 보정된 숫자를 보정 표시 없이 결재에 올리면 안 된다.
        h(
          'li',
          null,
          engine.calibration
            ? `예측 보정 적용: ${calibrationLabels(engine.calibration)}. 해당 지표는 시제품 실측으로 만든 1차식을 거친 값입니다.`
            : '예측 보정 없음: 표에 적힌 예측값은 실적 학습값 그대로이며 시제품 실측 보정을 거치지 않았습니다.',
        ),
        h('li', null, `근거등급 분포: ${gradeDistribution(plan)}. ${GRADE_NOTE.D}`),
        h('li', null, '매수는 DB 실적 매수범위 안에서만 탐색합니다. 실적 범위를 벗어난 설계는 이 도구가 판단하지 않습니다.'),
        h('li', null, '케이스 도면·단자 위치·패킹 호환성은 검증하지 않습니다. 도면으로 별도 확인이 필요합니다.'),
        h('li', null, '원가는 극판 재료비와 조립비 중심의 비교값이며 견적가가 아닙니다.'),
        h('li', null, '이 보고서는 설계 검토 지원 자료이며 시제품 시험과 Gate 승인을 대체하지 않습니다.'),
      ),
    ),

    stepNav(ctx, { back: { view: 'costing', label: '원가로' } }),
  );
}

const meta = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));

function firstShortfall(design) {
  const items = [
    ['C20', design.c20Margin],
    ['RC', design.rcMargin],
    ['EN CCA', design.ccaMargin],
    ['SAE CCA', design.saeMargin],
  ].filter(([, value]) => value === null || value < 0);
  if (!items.length) return design.warning || '경고';
  return items.map(([label, value]) => `${label} ${margin(value)}`).join(', ');
}

/** 보고서에 적을 보정 적용 지표 목록. 엔진이 실제로 쓰고 있는 것만 나온다. */
function calibrationLabels(calibration) {
  const LABELS = { c20: 'C20 용량', rc: 'RC', encca: 'EN CCA', saecca: 'SAE CCA' };
  return Object.keys(calibration)
    .map((key) => LABELS[key] || key)
    .join(', ');
}

function gradeDistribution(plan) {
  const counts = {};
  for (const d of plan.designs) counts[d.evidenceGrade] = (counts[d.evidenceGrade] || 0) + 1;
  return Object.entries(counts)
    .sort()
    .map(([grade, count]) => `${grade}등급 ${count}건`)
    .join(' · ');
}

function exportRequirements(ctx) {
  const { project, engine } = ctx;
  const rows = [
    ['제품', '제품군', '기술', 'C20(Ah)', 'RC(분)', 'EN CCA(A)', 'SAE CCA(A)', '최대매수', '셀수', '연간수량', '지정 기준품'],
    ...project.lineup.map((item) => [
      item.name,
      item.group,
      engine.technologyOf(item.group),
      item.targetC20,
      item.targetRc,
      item.targetEnCca,
      item.targetSaeCca,
      item.maxPlates,
      item.cellCount,
      item.annualVolume,
      item.preferredReferenceCode || '',
    ]),
  ];
  downloadCsv(`${project.name}-요구사양.csv`, rows);
}
