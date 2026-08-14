/**
 * src/views/matching.js — 기존 PCC 매칭.
 * 신규 설계 전에 "이미 있는 제품으로 되는가"를 먼저 확인하는 화면.
 */
import { h, icon, table } from '../lib/dom.js';
import { num, won, margin, marginClass } from '../core/format.js';
import { sectionHead, stepNav, marginChip, notice } from './parts.js';

export function renderMatching(ctx) {
  const { engine, project } = ctx;

  return h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'REFERENCE MATCH',
      title: '기존 제품·PCC 매칭',
      description:
        '입력한 목표를 이미 만족하는 등록 제품이 있는지 먼저 확인합니다. 4개 성능과 매수 조건을 모두 통과한 제품만 직접 적용 후보입니다.',
    }),

    notice(
      'info',
      '케이스 도면·단자 위치 호환성은 이 화면에서 판정하지 않습니다. 외형 치수는 도면으로 별도 확인하세요.',
    ),

    ...project.lineup.map((item) => productMatch(ctx, item)),

    stepNav(ctx, {
      back: { view: 'requirements', label: '요구사양으로' },
      next: 'design',
      nextLabel: '설계·BOM 비교로 이동',
      onNext: () => {
        if (ctx.recalculate()) ctx.goto('design');
      },
    }),
  );
}

function productMatch(ctx, item) {
  const { engine } = ctx;
  const profile = engine.groupProfile(item.group, item.type);

  if (!profile.valid) {
    return h(
      'section.card',
      null,
      h('h3', null, `${item.name} · ${item.group}`),
      notice('error', profile.reason),
    );
  }

  const candidates = engine.matchExisting(item, 6);
  const directFits = candidates.filter((c) => c.directFit);

  return h(
    'section.card',
    null,
    h(
      'header.card-head',
      null,
      h(
        'div',
        null,
        h('h3', null, `${item.name} · ${item.group}`),
        h(
          'p.card-note',
          null,
          `목표 C20 ${num(item.targetC20, 1)}Ah · RC ${num(item.targetRc)}분 · EN ${num(item.targetEnCca)}A · SAE ${num(item.targetSaeCca)}A · 상한 ${item.maxPlates}매`,
        ),
      ),
      h(
        'span',
        { class: `match-badge ${directFits.length ? 'ok' : 'none'}` },
        directFits.length ? `직접 적용 가능 ${directFits.length}건` : '직접 적용 가능 없음 · 신규 설계 필요',
      ),
    ),

    table(
      [
        {
          label: '제품코드',
          format: (c) => h('div.cell-stack', null, h('strong', null, c.reference.code), h('small', null, c.reference.name)),
        },
        {
          label: '판정',
          format: (c) =>
            h(`span.fit-chip.${c.directFit ? 'direct' : 'near'}`, null, c.directFit ? '직접 적용 가능' : '근접 설계'),
        },
        { label: '매수', align: 'right', format: (c) => `${c.reference.assembly}매` },
        { label: '극판 조합', format: (c) => `${c.reference.posCode} / ${c.reference.negCode}` },
        {
          label: '성능여유',
          format: (c) =>
            h(
              'div.margin-row',
              null,
              marginChip('C20', c.margins.c20),
              marginChip('RC', c.margins.rc),
              marginChip('EN', c.margins.enCca),
              marginChip('SAE', c.margins.saeCca),
            ),
        },
        { label: '판매실적', align: 'right', format: (c) => (engine.soldQty(c.reference.code) ? `${num(engine.soldQty(c.reference.code))}대` : '—') },
        {
          label: '기준품',
          format: (c) =>
            h(
              'button',
              {
                type: 'button',
                class: `chip-button ${item.preferredReferenceCode === c.reference.code ? 'selected' : ''}`,
                onclick: () => {
                  const next = item.preferredReferenceCode === c.reference.code ? undefined : c.reference.code;
                  ctx.patchItem(item.uid, { preferredReferenceCode: next });
                  ctx.recalculate({ silent: true });
                  ctx.render();
                },
              },
              item.preferredReferenceCode === c.reference.code ? '지정됨' : '지정',
            ),
        },
      ],
      candidates,
      { rowClass: (c) => (c.directFit ? 'direct-fit' : null) },
    ),

    item.preferredReferenceCode &&
      h(
        'p.card-note.pinned',
        null,
        icon('check', 14),
        ` 기준품 ${item.preferredReferenceCode} 지정됨 — 3안(기존 극판 공용)에서 이 제품의 등록 BOM·성능·매수를 그대로 적용합니다.`,
      ),
  );
}
