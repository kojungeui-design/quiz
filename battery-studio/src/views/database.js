/**
 * src/views/database.js — DB 조회와 갱신.
 * 제품군 학습값·극판 마스터·백테스트를 확인하고, 사내 DB를 CSV로 올려 갱신한다.
 */
import { h, icon, table } from '../lib/dom.js';
import { num, won, pct, dateLabel } from '../core/format.js';
import { downloadCsv } from '../core/export.js';
import { readImportFile, validateOverlay, templateRows, exportRows } from '../core/dbsource.js';
import { sectionHead, gradeChip, notice } from './parts.js';

export function renderDatabase(ctx) {
  const { engine } = ctx;
  const stats = engine.dbStats;

  const groupBody = h('div');
  const search = h('input', {
    type: 'search',
    placeholder: '제품군 검색 (예: LN, DIN, B19)',
    'aria-label': '제품군 검색',
    oninput: (event) => renderGroups(event.target.value),
  });

  function renderGroups(query = '') {
    const keyword = query.trim().toUpperCase();
    const rows = engine.groupLearning.filter((g) => !keyword || g.group.toUpperCase().includes(keyword));
    groupBody.replaceChildren(
      h('p.card-note', null, `${rows.length}개 제품군`),
      table(
        [
          { label: '제품군', format: (g) => h('div.cell-stack', null, h('strong', null, g.group), h('small', null, g.technology)) },
          { label: '근거', format: (g) => gradeChip(g.evidenceGrade) },
          { label: '학습 기준', format: (g) => g.learningBasis },
          { label: '판매 제품', align: 'right', format: (g) => `${g.currentProducts}종` },
          { label: '판매수량', align: 'right', format: (g) => num(g.currentSalesQty) },
          { label: '매수', align: 'right', format: (g) => (g.assembly.max ? `${g.assembly.min}–${g.assembly.max}매` : '—') },
          { label: 'C20', align: 'right', format: (g) => (g.performance.c20.typical ? `${num(g.performance.c20.typical, 1)} Ah` : '—') },
          { label: 'RC', align: 'right', format: (g) => (g.performance.rc.typical ? `${num(g.performance.rc.typical)} 분` : '—') },
          { label: 'EN CCA', align: 'right', format: (g) => (g.performance.enCca.typical ? `${num(g.performance.enCca.typical)} A` : '—') },
          { label: 'SAE CCA', align: 'right', format: (g) => (g.performance.saeCca.typical ? `${num(g.performance.saeCca.typical)} A` : '—') },
          {
            label: '대표 조합',
            format: (g) =>
              g.topDesigns.length
                ? h('div.cell-stack', null, h('strong', null, `${g.topDesigns[0].posCode} / ${g.topDesigns[0].negCode}`), h('small', null, g.topDesigns[0].assembly))
                : '—',
          },
        ],
        rows,
      ),
    );
  }

  const backtestBody = h('div', null, h('p.card-note', null, '전수 계산이라 몇 초 걸립니다.'));
  const runBacktest = h(
    'button.secondary-button',
    {
      type: 'button',
      onclick: () => {
        runBacktest.disabled = true;
        runBacktest.textContent = '계산 중…';
        // 버튼 상태가 화면에 먼저 그려지도록 한 프레임 양보한 뒤 계산한다.
        setTimeout(() => {
          const result = engine.backtestAll();
          backtestBody.replaceChildren(
            table(
              [
                { label: '지표', key: 'label' },
                { label: '표본', align: 'right', format: (r) => `${num(r.samples)}건` },
                { label: 'MAPE', align: 'right', format: (r) => pct(r.mape, 1) },
              ],
              [
                { label: 'C20 용량', ...result.c20 },
                { label: 'RC', ...result.rc },
                { label: 'EN CCA', ...result.enCca },
                { label: 'SAE CCA', ...result.saeCca },
              ],
            ),
            h(
              'p.card-note',
              null,
              '실적 제품 하나를 빼고 같은 극판 조합의 나머지로 그 제품을 예측한 오차입니다. 예측식이 DB 자신을 얼마나 재현하는지의 하한선이며, 신제품 정확도의 보증이 아닙니다.',
            ),
          );
          runBacktest.disabled = false;
          runBacktest.textContent = '다시 계산';
        }, 30);
      },
    },
    '백테스트 실행',
  );

  /* ======================= 사내 DB 갱신 ======================= */

  /**
   * 올린 파일은 바로 반영하지 않고 여기에 쌓아 둔다. 제품이 새 극판을 참조하는 경우가 많아
   * 두 파일을 함께 검증해야 "극판 미등록" 오류가 헛되이 나지 않는다.
   */
  const staged = { products: null, plates: null, sources: [] };
  let mode = 'merge';

  const stagedBody = h('div.import-staged');
  const applyButton = h('button.primary-button', { type: 'button', disabled: true }, icon('check', 15), ' 적용');

  const modeChoice = (value, label, description) =>
    h(
      `label.import-mode${mode === value ? '.active' : ''}`,
      null,
      h('input', {
        type: 'radio',
        name: 'bds-import-mode',
        value,
        checked: mode === value,
        onchange: () => {
          mode = value;
          renderStaged();
        },
      }),
      h('div', null, h('strong', null, label), h('small', null, description)),
    );

  function renderStaged() {
    if (!staged.products && !staged.plates) {
      stagedBody.replaceChildren(
        h('p.card-note', null, '아직 올린 파일이 없습니다. 제품 파일과 극판 파일을 함께 올리면 서로 참조를 검증합니다.'),
      );
      applyButton.disabled = true;
      return;
    }

    const result = validateOverlay(ctx.baseDb, staged, mode);
    const s = result.summary;
    const accepted = s.productsAccepted + s.platesAccepted;
    applyButton.disabled = accepted === 0;

    const issueLimit = 100;
    stagedBody.replaceChildren(
      h(
        'ul.import-files',
        null,
        staged.sources.map((source) =>
          h(
            'li',
            null,
            h('strong', null, source.name),
            h('span', null, `${source.kind === 'plates' ? '극판' : '제품'} ${num(source.rows)}행`),
            h('button.link-button', {
              type: 'button',
              onclick: () => {
                staged[source.kind] = null;
                staged.sources = staged.sources.filter((x) => x !== source);
                renderStaged();
              },
            }, '빼기'),
          ),
        ),
      ),

      h(
        'div.import-modes',
        null,
        modeChoice('merge', '병합', '같은 코드는 덮어쓰고, 올리지 않은 기존 데이터는 그대로 둡니다.'),
        modeChoice('replace', '대체', '올린 종류(제품/극판)를 통째로 바꿉니다. 파일에 없는 기존 항목은 사라집니다.'),
      ),

      h(
        'div.kpi-row.compact',
        null,
        dbKpi('반영될 제품', num(s.resultProducts), `현재 ${num(stats.references)}건`),
        dbKpi('반영될 극판', num(s.resultPlates), `현재 ${num(stats.plates)}건`),
        dbKpi('정상 행', num(accepted), '건'),
        dbKpi('반려 행', num(s.rejected), '건'),
        s.obsoletePlates ? dbKpi('단종 표시', num(s.obsoletePlates), '종 (실적은 근거로 남습니다)') : null,
      ),

      result.issues.length
        ? h(
            'div.import-issues',
            null,
            notice(
              'warn',
              `${num(result.issues.length)}건은 반영되지 않습니다. 아래 사유를 고쳐서 다시 올리면 됩니다. 나머지 ${num(accepted)}건만 적용할 수 있습니다.`,
              h(
                'button.link-button',
                {
                  type: 'button',
                  onclick: () =>
                    downloadCsv('DB임포트_반려목록.csv', [
                      ['종류', '행', '코드', '사유'],
                      ...result.issues.map((x) => [x.kind === 'plates' ? '극판' : '제품', x.row, x.code, x.message]),
                    ]),
                },
                '반려 목록 CSV',
              ),
            ),
            table(
              [
                { label: '종류', format: (x) => (x.kind === 'plates' ? '극판' : '제품') },
                { label: '행', align: 'right', key: 'row' },
                { label: '코드', key: 'code' },
                { label: '사유', key: 'message' },
              ],
              result.issues.slice(0, issueLimit),
            ),
            result.issues.length > issueLimit
              ? h('p.card-note', null, `표에는 ${issueLimit}건만 보입니다. 전체는 위의 CSV로 받아보세요.`)
              : null,
          )
        : notice('ok', `${num(accepted)}건 모두 검증을 통과했습니다.`),
    );

    applyButton.onApply = () => result;
  }

  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,.json',
    multiple: true,
    'aria-label': 'DB 파일 선택',
    onchange: async (event) => {
      const files = [...(event.target.files || [])];
      for (const file of files) {
        try {
          const parsed = readImportFile(await file.text(), file.name);
          staged[parsed.kind] = parsed.rows;
          staged.sources = [
            ...staged.sources.filter((x) => x.kind !== parsed.kind),
            { name: file.name, kind: parsed.kind, rows: parsed.rows.length },
          ];
          if (parsed.issues.length) {
            ctx.toast(`${file.name}: 숫자로 읽지 못한 칸이 ${parsed.issues.length}건 있습니다. 검증 결과를 확인하세요.`, 'warn', 7000);
          }
        } catch (error) {
          ctx.toast(`${file.name}: ${error.message}`, 'error', 9000);
        }
      }
      event.target.value = '';
      renderStaged();
    },
  });

  applyButton.addEventListener('click', async () => {
    const result = applyButton.onApply?.();
    if (!result) return;
    const s = result.summary;
    const confirmed = await ctx.confirmAction({
      title: '임포트 DB를 적용할까요?',
      message:
        `제품 ${num(s.resultProducts)}건 · 극판 ${num(s.resultPlates)}건으로 바뀝니다. ` +
        '저장된 과제의 계산 결과는 근거가 달라지므로 모두 "재계산 필요" 상태가 됩니다. ' +
        '언제든 해제하면 내장 DB로 돌아옵니다.',
      confirmLabel: '적용',
    });
    if (!confirmed) return;

    const applied = ctx.setDbOverlay({
      mode: result.mode,
      importedAt: new Date().toISOString(),
      sources: staged.sources.map((x) => x.name),
      products: result.products,
      plates: result.plates,
      salesQty: result.salesQty,
    });
    if (!applied.ok) {
      ctx.toast(applied.message, 'error', 12000);
      return;
    }
    ctx.toast(`임포트 DB를 적용했습니다. 제품 ${num(s.resultProducts)}건 · 극판 ${num(s.resultPlates)}건.`, 'success', 6000);
  });

  const overlay = ctx.db.overlay;
  const importCard = h(
    'section.card',
    null,
    h(
      'header.card-head',
      null,
      h('h3', null, '사내 DB 갱신'),
      h(
        'div.card-tools',
        null,
        h('button.link-button', { type: 'button', onclick: () => downloadCsv('제품_양식.csv', templateRows('products')) }, '제품 양식'),
        h('button.link-button', { type: 'button', onclick: () => downloadCsv('극판_양식.csv', templateRows('plates')) }, '극판 양식'),
        h('button.link-button', { type: 'button', onclick: () => downloadCsv('현재DB_제품.csv', exportRows(ctx.db, 'products')) }, '현재 제품 내보내기'),
        h('button.link-button', { type: 'button', onclick: () => downloadCsv('현재DB_극판.csv', exportRows(ctx.db, 'plates')) }, '현재 극판 내보내기'),
      ),
    ),

    overlay
      ? notice(
          'ok',
          `임포트 DB 적용 중 — ${dateLabel(overlay.importedAt)} · ${overlay.sources.join(', ') || '파일명 없음'} ` +
            `(내장 제품 ${num(overlay.baseProducts)}건 → ${num(stats.references)}건)`,
          h(
            'button.link-button',
            {
              type: 'button',
              onclick: async () => {
                const confirmed = await ctx.confirmAction({
                  title: '임포트 DB를 해제할까요?',
                  message: `내장 DB(제품 ${num(overlay.baseProducts)}건)로 돌아갑니다. 올린 데이터는 지워지므로 다시 올려야 합니다.`,
                  confirmLabel: '해제',
                  danger: true,
                });
                if (!confirmed) return;
                ctx.setDbOverlay(null);
                ctx.toast('내장 DB로 돌아왔습니다.', 'info');
              },
            },
            '해제하고 내장 DB로',
          ),
        )
      : h(
          'p.card-note',
          null,
          '지금은 빌드에 실린 내장 DB를 쓰고 있습니다. 사내 실적이 갱신되었다면 CSV로 올려 덮어쓸 수 있습니다.',
        ),

    h('div.import-drop', null, h('label.secondary-button.file-button', null, icon('download', 15), ' 파일 선택 (CSV · JSON)', fileInput)),
    stagedBody,
    h('div.card-actions', null, applyButton),
    h(
      'p.card-note',
      null,
      '열 이름은 한글·영문 모두 인식합니다(예: 제품코드/code, 조립매수/assembly). 검증 규칙은 빌드할 때와 같아서, ' +
        '여기서 통과한 데이터는 data/source 에 넣어도 그대로 빌드됩니다. 임포트 DB는 이 브라우저에만 저장되며 팀에 공유되지 않습니다.',
    ),
  );

  renderStaged();

  const view = h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'DATABASE',
      title: '제품·성능·극판 DB',
      description: '설계 예측이 어떤 실적을 근거로 삼는지 확인하는 화면입니다.',
    }),

    ctx.db.masked ? notice('error', '지금 열려 있는 데이터는 시연용 마스킹본입니다. 단가와 판매수량이 실제 값이 아닙니다.') : null,

    h(
      'div.kpi-row',
      null,
      dbKpi('실적 제품', num(stats.references), '건'),
      dbKpi('극판 마스터', num(stats.plates), '건'),
      dbKpi('제품군', num(stats.groups), '개'),
      dbKpi('학습 가능', `${stats.readyCurrentGroups}/${stats.groups}`, '제품군'),
    ),

    importCard,

    h(
      'section.card',
      null,
      h('header.card-head', null, h('h3', null, '제품군 학습값'), h('div.card-tools', null, search)),
      groupBody,
    ),

    h(
      'section.card',
      null,
      h('header.card-head', null, h('h3', null, '예측식 백테스트'), runBacktest),
      backtestBody,
    ),

    h(
      'section.card',
      null,
      h('h3', null, '데이터 결측'),
      h(
        'div.missing-grid',
        null,
        ...Object.entries({
          외형치수: stats.missing.dimensions,
          RC: stats.missing.rc,
          'EN CCA': stats.missing.enCca,
          'SAE CCA': stats.missing.saeCca,
          중량: stats.missing.weight,
          연량: stats.missing.lead,
        }).map(([label, count]) =>
          h(
            'div.missing-item',
            null,
            h('span', null, label),
            h('strong', { class: count > stats.references * 0.3 ? 'high' : '' }, num(count)),
            h('small', null, `${pct((count / stats.references) * 100, 0)} 결측`),
          ),
        ),
      ),
      h('p.card-note', null, '결측이 많은 지표는 제품군 대표값의 신뢰도가 떨어집니다. 근거등급에 이미 반영되어 있습니다.'),
    ),

    h(
      'section.card',
      null,
      h('h3', null, '극판 마스터'),
      table(
        [
          { label: '코드', key: 'code' },
          { label: '명칭', key: 'name' },
          { label: '역할', format: (p) => ({ positive: '양극', negative: '음극', both: '공용', unknown: '미분류' }[p.role] || p.role) },
          { label: '크기', format: (p) => `${p.width}×${p.height}` },
          { label: '두께', key: 'thickness' },
          { label: '기판중량', align: 'right', format: (p) => `${num(p.baseWeight, 1)} g` },
          { label: '활물질', align: 'right', format: (p) => `${num(p.activeWeight)} g` },
          { label: '단가', align: 'right', format: (p) => won(p.cost) },
          { label: '사용 제품', align: 'right', format: (p) => `${p.usage}종` },
          {
            label: '상태',
            format: (p) =>
              engine.isPlateActive(p.code)
                ? h('small.muted-cell', null, '사용중')
                : h('span.obsolete-chip', null, engine.plateStatusLabel(p.code)),
          },
        ],
        // 단종된 극판을 위로 올린다. "무엇이 더는 못 쓰는가"가 이 표에서 제일 먼저 볼 것이다.
        [...engine.plates].sort(
          (a, b) =>
            Number(engine.isPlateActive(a.code)) - Number(engine.isPlateActive(b.code)) || b.usage - a.usage,
        ),
      ),
    ),
  );

  renderGroups();
  return view;
}

const dbKpi = (label, value, unit) => h('div.kpi', null, h('span', null, label), h('strong', null, value), h('small', null, unit));
