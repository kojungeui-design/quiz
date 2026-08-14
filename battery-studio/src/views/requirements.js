/**
 * src/views/requirements.js — 요구사양 입력.
 *
 * 화면 전체를 다시 그리지 않는다. 값이 바뀌면 그 줄의 상태 배지만 갱신한다.
 * 그래서 입력 도중 포커스가 튀지 않는다.
 */
import { h, icon } from '../lib/dom.js';
import { validateItem, createLineupItem, nextProductName, duplicateName, cloneItem } from '../core/project.js';
import { num } from '../core/format.js';
import { sectionHead, stepNav, numberField, selectField, textField, notice } from './parts.js';

const TARGETS = [
  { key: 'targetC20', label: 'C20 용량', unit: 'Ah', softRange: [10, 250], learn: (l) => l?.performance.c20.typical },
  { key: 'targetRc', label: 'RC', unit: '분', softRange: [20, 400], learn: (l) => l?.performance.rc.typical },
  { key: 'targetEnCca', label: 'EN CCA', unit: 'A', softRange: [100, 1500], learn: (l) => l?.performance.enCca.typical },
  { key: 'targetSaeCca', label: 'SAE CCA', unit: 'A', softRange: [100, 1500], learn: (l) => l?.performance.saeCca.typical },
];

export function renderRequirements(ctx) {
  const { engine, project } = ctx;
  const view = h('div.view');

  const summary = h('div.lineup-summary');
  const updateSummary = () => {
    const results = project.lineup.map((item) => validateItem(engine, item, project.lineup));
    const errors = results.reduce((sum, r) => sum + r.errors.length, 0);
    const warnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
    summary.replaceChildren(
      h('strong', null, `${project.lineup.length}개 제품`),
      errors
        ? h('span.summary-error', null, `입력 오류 ${errors}건 — 계산할 수 없습니다`)
        : h('span.summary-ok', null, '입력 완료'),
      warnings ? h('span.summary-warn', null, `확인 권장 ${warnings}건`) : null,
    );
    const blocked = errors > 0;
    proceedButton.disabled = blocked;
    proceedButton.title = blocked ? '입력 오류를 먼저 해결하세요.' : '';
  };

  const proceedButton = h(
    'button.primary-button',
    {
      type: 'button',
      onclick: () => {
        if (ctx.recalculate()) ctx.goto('matching');
      },
    },
    '기존 PCC 매칭으로 이동 ',
    icon('arrowRight', 15),
  );

  const cards = h('div.lineup-grid');
  const rebuild = () => {
    cards.replaceChildren(...project.lineup.map((item) => productCard(ctx, item, updateSummary, rebuild)));
    updateSummary();
  };

  view.append(
    sectionHead({
      eyebrow: 'REQUIREMENTS',
      title: '고객 요구사양',
      description: '제품군을 고르면 그 제품군 실적의 대표값이 목표 초기값으로 채워집니다. 고객 요구값으로 바꿔 입력하세요.',
      actions: [
        h(
          'button.secondary-button',
          {
            type: 'button',
            onclick: () => {
              const group = engine.groups.find((g) => g.currentProducts > 0)?.group || engine.groups[0].group;
              ctx.setLineup([...project.lineup, createLineupItem(engine, group, nextProductName(project.lineup))]);
              rebuild();
            },
          },
          icon('plus', 15),
          ' 제품 추가',
        ),
      ],
    }),

    projectMeta(ctx),

    h('div.lineup-head', null, h('h3', null, '라인업 목표 성능'), summary),
    cards,
    assumptionsCard(ctx),
    h('div.step-nav', null, h('span'), proceedButton),
  );

  rebuild();
  return view;
}

function projectMeta(ctx) {
  const { project } = ctx;
  return h(
    'section.card.meta-card',
    null,
    h('h3', null, '과제 정보'),
    h(
      'div.field-grid',
      null,
      textField({ label: '과제명', value: project.name, onInput: (v) => ctx.patchProject({ name: v }) }),
      textField({ label: '고객', value: project.customer, placeholder: '고객사', onInput: (v) => ctx.patchProject({ customer: v }) }),
      textField({ label: 'RFQ / CR 번호', value: project.requestNo, onInput: (v) => ctx.patchProject({ requestNo: v }) }),
      textField({ label: '담당자', value: project.owner, onInput: (v) => ctx.patchProject({ owner: v }) }),
      selectField({
        label: '비교 관점',
        value: project.objective,
        options: [
          { value: 'balanced', label: '균형 (공용화 우선)' },
          { value: 'cost', label: '원가 우선' },
          { value: 'performance', label: '성능 우선' },
        ],
        onChange: (v) => {
          ctx.patchProject({ objective: v });
          ctx.recalculate({ silent: true });
        },
      }),
    ),
  );
}

function productCard(ctx, item, updateSummary, rebuild) {
  const { engine, project } = ctx;
  const learning = engine.learningByGroup.get(item.group);

  const statusRow = h('div.card-status');
  const messages = h('div.card-messages');
  const refresh = () => {
    const { errors, warnings, ok } = validateItem(engine, item, project.lineup);
    statusRow.replaceChildren(
      h(`span.row-status.${ok ? 'pass' : 'error'}`, null, icon(ok ? 'check' : 'alert', 13), ok ? '입력 완료' : '입력 확인'),
      learning && h('small', null, `DB 근거 ${learning.evidenceGrade}등급 · 실적매수 ${learning.assembly.min}–${learning.assembly.max}매`),
    );
    messages.replaceChildren(
      ...errors.map((message) => h('p.message-error', null, message)),
      ...warnings.map((message) => h('p.message-warn', null, message)),
    );
    updateSummary();
  };

  const patch = (changes) => {
    Object.assign(item, changes);
    ctx.patchItem(item.uid, changes);
    refresh();
  };

  const card = h(
    'article.lineup-card',
    null,
    h(
      'header.lineup-card-head',
      null,
      h('input.product-name', {
        type: 'text',
        value: item.name,
        'aria-label': '제품 이름',
        oninput: (event) => patch({ name: event.target.value }),
      }),
      h(
        'div.row-actions',
        null,
        h(
          'button.icon-button',
          {
            type: 'button',
            title: '제품 복제',
            'aria-label': `${item.name} 복제`,
            onclick: () => {
              const index = project.lineup.findIndex((x) => x.uid === item.uid);
              const copy = cloneItem(item, duplicateName(project.lineup, item.name));
              ctx.setLineup([...project.lineup.slice(0, index + 1), copy, ...project.lineup.slice(index + 1)]);
              rebuild();
            },
          },
          icon('copy', 15),
        ),
        h(
          'button.icon-button.danger',
          {
            type: 'button',
            title: '제품 삭제',
            'aria-label': `${item.name} 삭제`,
            disabled: project.lineup.length === 1,
            onclick: () => {
              ctx.setLineup(project.lineup.filter((x) => x.uid !== item.uid));
              rebuild();
            },
          },
          icon('trash', 15),
        ),
      ),
    ),

    h(
      'div.field-grid.two',
      null,
      selectField({
        label: '제품군',
        value: item.group,
        ariaLabel: `${item.name} 제품군`,
        options: engine.groupLearning.map((g) => ({
          value: g.group,
          label: `${g.group} · ${g.technology} · ${g.evidenceGrade}등급${g.currentProducts ? ` · 판매 ${g.currentProducts}종` : ''}`,
        })),
        onChange: (group) => {
          const next = engine.learningByGroup.get(group);
          patch({
            group,
            type: engine.technologyOf(group),
            preferredReferenceCode: undefined,
            ...(next && next.assembly.max > 0
              ? {
                  targetC20: next.performance.c20.typical,
                  targetRc: next.performance.rc.typical,
                  targetEnCca: next.performance.enCca.typical,
                  targetSaeCca: next.performance.saeCca.typical,
                  maxPlates: next.assembly.max,
                }
              : {}),
          });
          rebuild();
        },
      }),
      h('div.readonly-field', null, h('span.field-label', null, '기술'), h('strong', null, engine.technologyOf(item.group))),
    ),

    h(
      'div.field-grid.four',
      null,
      ...TARGETS.map((target) =>
        numberField({
          label: target.label,
          unit: target.unit,
          value: item[target.key],
          min: 0,
          softRange: target.softRange,
          ariaLabel: `${item.name} ${target.label} 목표`,
          hint: learning ? `DB 대표 ${num(target.learn(learning), 0)}${target.unit}` : '',
          onInput: (value) => patch({ [target.key]: value }),
        }),
      ),
    ),

    h(
      'div.field-grid.three',
      null,
      numberField({
        label: '최대 허용매수',
        unit: '매/셀',
        value: item.maxPlates,
        min: 1,
        softRange: [7, 40],
        ariaLabel: `${item.name} 최대 허용매수`,
        hint: learning ? `DB 실적 ${learning.assembly.min}–${learning.assembly.max}매` : '',
        onInput: (value) => patch({ maxPlates: value }),
      }),
      numberField({
        label: '셀 수',
        unit: '셀',
        value: item.cellCount,
        min: 1,
        softRange: [3, 12],
        ariaLabel: `${item.name} 셀 수`,
        hint: '12V 제품은 6셀',
        onInput: (value) => patch({ cellCount: value }),
      }),
      numberField({
        label: '연간 기준수량',
        unit: '대',
        value: item.annualVolume,
        min: 1,
        step: 5000,
        softRange: [1, 5000000],
        ariaLabel: `${item.name} 연간 기준수량`,
        hint: '금형 투자비 배부 기준',
        onInput: (value) => patch({ annualVolume: value }),
      }),
    ),

    statusRow,
    messages,
  );

  refresh();
  return card;
}

function assumptionsCard(ctx) {
  const { project } = ctx;
  const patch = (changes) => ctx.patchProject({ assumptions: { ...project.assumptions, ...changes } });
  return h(
    'section.card',
    null,
    h('h3', null, '원가 계산 기준'),
    h('p.card-note', null, '신규 금형 투자는 공용 극판군당 1회 발생하는 것으로 보고, 그 극판군을 쓰는 연간물량 전체에 나눠 싣습니다.'),
    h(
      'div.field-grid.four',
      null,
      numberField({
        label: '조립·전해액 등',
        unit: '원/대',
        value: project.assumptions.conversionCost,
        min: 0,
        step: 100,
        onInput: (v) => patch({ conversionCost: v }),
      }),
      numberField({
        label: '신형 양·음극 투자',
        unit: '원/극판군',
        value: project.assumptions.newToolingCost,
        min: 0,
        step: 1000000,
        onInput: (v) => patch({ newToolingCost: v }),
      }),
      numberField({
        label: '신형 양극만 투자',
        unit: '원/극판군',
        value: project.assumptions.hybridToolingCost,
        min: 0,
        step: 1000000,
        onInput: (v) => patch({ hybridToolingCost: v }),
      }),
      numberField({
        label: '재료비 우발률',
        unit: '%',
        value: project.assumptions.contingencyRate,
        min: 0,
        max: 50,
        step: 0.5,
        onInput: (v) => patch({ contingencyRate: v }),
      }),
    ),
  );
}
