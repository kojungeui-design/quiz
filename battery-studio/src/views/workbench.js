/**
 * src/views/workbench.js — 과제 목록, 새 과제, 백업·복원, 데이터 준비도.
 */
import { h, icon, table } from '../lib/dom.js';
import { toast } from '../lib/store.js';
import { backupPayload, parseBackup, storageUsage } from '../core/storage.js';
import { downloadJson } from '../core/export.js';
import { normalizeProject } from '../core/project.js';
import { STATUS_LABEL, OBJECTIVE_LABEL, dateLabel, num, won } from '../core/format.js';
import { sectionHead } from './parts.js';

export function renderWorkbench(ctx) {
  const { projects, project: current } = ctx.state;
  const { engine } = ctx;

  const usage = storageUsage();
  const usagePct = Math.min(100, Math.round((usage.bytes / usage.limit) * 100));

  return h(
    'div.view',
    null,
    sectionHead({
      eyebrow: 'WORKBENCH',
      title: '제품개발 워크벤치',
      description: '요구사양부터 보고서까지 한 과제 안에서 진행합니다. 과제는 이 브라우저에 자동 저장됩니다.',
      actions: [
        h('button.primary-button', { type: 'button', onclick: () => ctx.newProject() }, icon('plus', 15), ' 새 과제 시작'),
        h(
          'button.secondary-button',
          { type: 'button', onclick: () => downloadJson(`BDS-백업-${new Date().toISOString().slice(0, 10)}.json`, backupPayload(projects)) },
          icon('download', 15),
          ' 백업 내보내기',
        ),
        restoreButton(ctx),
      ],
    }),

    h(
      'div.kpi-row',
      null,
      kpi('저장된 과제', num(projects.length), '개'),
      kpi('설계 DB 제품', num(engine.dbStats.references), '건'),
      kpi('극판 마스터', num(engine.dbStats.plates), '건'),
      kpi('학습 가능 제품군', `${engine.dbStats.readyCurrentGroups}/${engine.dbStats.groups}`, '개'),
    ),

    projects.length
      ? h(
          'section.card',
          null,
          h('h3', null, '개발 과제'),
          table(
            [
              {
                label: '과제',
                format: (p) =>
                  h('div.cell-stack', null, h('strong', null, p.name), h('small', null, p.customer || '고객 미지정')),
              },
              { label: '제품 수', align: 'right', format: (p) => `${p.lineup.length}개` },
              { label: '단계', format: (p) => h(`span.status-chip.${p.status}`, null, STATUS_LABEL[p.status]) },
              { label: '관점', format: (p) => OBJECTIVE_LABEL[p.objective] },
              {
                label: '선택안 평균원가',
                align: 'right',
                format: (p) => (p.resultSnapshot ? won(p.resultSnapshot.averageCost) : '미계산'),
              },
              { label: '마지막 수정', format: (p) => dateLabel(p.updatedAt) },
              {
                label: '',
                format: (p) =>
                  h(
                    'div.row-actions',
                    null,
                    h('button.secondary-button.small', { type: 'button', onclick: () => ctx.openProject(p) }, '열기'),
                    h(
                      'button.icon-button.danger',
                      { type: 'button', title: '과제 삭제', 'aria-label': `${p.name} 삭제`, onclick: () => ctx.deleteProject(p.id) },
                      icon('trash', 15),
                    ),
                  ),
              },
            ],
            projects,
            { rowClass: (p) => (current?.id === p.id ? 'current' : null) },
          ),
        )
      : h(
          'section.card.empty-state',
          null,
          icon('layers', 34),
          h('h3', null, '아직 과제가 없습니다'),
          h('p', null, '새 과제를 시작하면 제품군을 고르고 목표 성능을 입력하는 화면으로 넘어갑니다.'),
          h('button.primary-button', { type: 'button', onclick: () => ctx.newProject() }, icon('plus', 15), ' 새 과제 시작'),
        ),

    h(
      'section.card',
      null,
      h('h3', null, '데이터 준비도'),
      h('p.card-note', null, '근거등급이 D인 제품군은 예측 근거가 없어 승인 자료로 쓸 수 없습니다. 시험 실적을 먼저 확보해야 합니다.'),
      gradeSummary(engine),
    ),

    h(
      'section.card.storage-card',
      null,
      h('h3', null, '저장 공간'),
      h('div.progress', null, h('i', { style: { width: `${usagePct}%` } })),
      h('p.card-note', null, `${Math.round(usage.bytes / 1024)}KB 사용 중 · 브라우저 한도 약 5MB (${usagePct}%)`),
      usagePct > 70 && h('p.inline-warn', null, '저장 공간이 부족해지고 있습니다. 끝난 과제는 백업 후 삭제하세요.'),
    ),
  );
}

function kpi(label, value, unit) {
  return h('div.kpi', null, h('span', null, label), h('strong', null, value), h('small', null, unit));
}

function gradeSummary(engine) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const g of engine.groupLearning) counts[g.evidenceGrade]++;
  const total = engine.groupLearning.length;
  return h(
    'div.grade-bars',
    null,
    ...['A', 'B', 'C', 'D'].map((grade) =>
      h(
        'div.grade-bar',
        null,
        h(`span.grade-chip.grade-${grade}`, null, grade),
        h('div.bar', null, h(`i.grade-${grade}`, { style: { width: `${(counts[grade] / total) * 100}%` } })),
        h('small', null, `${counts[grade]}개 제품군`),
      ),
    ),
  );
}

function restoreButton(ctx) {
  const input = h('input', {
    type: 'file',
    accept: '.json',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const restored = parseBackup(await file.text()).map((p) => normalizeProject(ctx.engine, p));
        const existing = ctx.state.projects;
        const byId = new Map(existing.map((p) => [p.id, p]));
        for (const p of restored) byId.set(p.id, p);
        ctx.setProjects([...byId.values()]);
        toast(`${restored.length}개 과제를 복원했습니다.`, 'success');
        ctx.render();
      } catch (error) {
        toast(`복원 실패: ${error.message}`, 'error', 8000);
      } finally {
        event.target.value = '';
      }
    },
  });
  return h('label.secondary-button.file-button', null, icon('save', 15), ' 백업 복원', input);
}
