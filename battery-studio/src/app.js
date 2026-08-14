/**
 * src/app.js — 앱 셸. 사이드바·상단바·화면 전환·자동저장을 담당한다.
 * 각 화면은 views/ 아래에서 DOM 노드를 만들어 돌려주고, 여기서는 붙이고 떼는 일만 한다.
 */
import { h, icon, clear, openModal } from './lib/dom.js';
import { createStore, toast, confirmAction } from './lib/store.js';
import { createEngine } from './core/engine.js';
import { createProject, normalizeProject, specsOf, validateLineup, ENGINE_VERSION } from './core/project.js';
import { loadProjects, createAutosave, guardUnload, storageUsage } from './core/storage.js';
import { loadOverlay, saveOverlay, clearOverlay, applyOverlay } from './core/dbsource.js';
import { loadCalibration, saveCalibration, activeCalibrationModels, emptyCalibration } from './core/calibration.js';
import { renderCalibration } from './views/calibration.js';
import { STATUS_LABEL, dateLabel } from './core/format.js';
import { renderWorkbench } from './views/workbench.js';
import { renderRequirements } from './views/requirements.js';
import { renderMatching } from './views/matching.js';
import { renderDesign } from './views/design.js';
import { renderCosting } from './views/costing.js';
import { renderReport } from './views/report.js';
import { renderDatabase } from './views/database.js';
import { HELP } from './help.js';

const VIEWS = [
  { id: 'workbench', label: '개발 워크벤치', icon: 'layers', section: '과제' },
  { id: 'requirements', label: '요구사양 입력', icon: 'target', section: '설계 단계' },
  { id: 'matching', label: '기존 PCC 매칭', icon: 'search' },
  { id: 'design', label: '설계·BOM·공용화', icon: 'grid' },
  { id: 'costing', label: '원가·수익성', icon: 'coins' },
  { id: 'report', label: '보고서·출력', icon: 'file' },
  { id: 'database', label: '제품·극판 DB', icon: 'database', section: '참조' },
  { id: 'calibration', label: '예측 보정', icon: 'target' },
];

/** 과제 없이도 열 수 있는 화면. 나머지는 과제를 먼저 골라야 한다. */
const PROJECTLESS_VIEWS = new Set(['workbench', 'database', 'calibration']);

const RENDERERS = {
  workbench: renderWorkbench,
  requirements: renderRequirements,
  matching: renderMatching,
  design: renderDesign,
  costing: renderCosting,
  report: renderReport,
  database: renderDatabase,
  calibration: renderCalibration,
};

/**
 * @param {HTMLElement} root
 * @param {object} baseDb  빌드에 실린 내장 DB. 사용자가 올린 임포트 DB는 이 위에 덮는다.
 */
export function startApp(root, baseDb) {
  // 내장 DB는 그대로 두고, 저장된 임포트 DB를 덮은 결과를 엔진에 넘긴다.
  // 임포트를 해제하면 baseDb 그대로 돌아오므로 되돌릴 수 없는 상태가 생기지 않는다.
  let overlay = loadOverlay();
  let calibration = loadCalibration() || emptyCalibration();
  let db = applyOverlay(baseDb, overlay);
  // 승인된 보정식만 엔진에 들어간다. 초안 상태의 적합은 예측에 영향을 주지 않는다.
  let engine = createEngine(db, { calibration: activeCalibrationModels(calibration) });

  const rebuildEngine = () => {
    db = applyOverlay(baseDb, overlay);
    engine = createEngine(db, { calibration: activeCalibrationModels(calibration) });
  };

  const store = createStore({
    view: 'workbench',
    projects: loadProjects().map((p) => normalizeProject(engine, p)),
    project: null,
    plans: null,
    plansStale: true, // 입력이 바뀌었는데 아직 계산하지 않은 상태
    saveState: { state: 'saved', label: '저장됨' },
    sidebarOpen: false,
  });

  const autosave = createAutosave({
    getProjects: () => {
      const { projects, project } = store.get();
      if (!project) return projects;
      return [project, ...projects.filter((p) => p.id !== project.id)];
    },
    onStateChange: (saveState) => {
      store.set({ saveState });
      if (saveState.state === 'error') toast(saveState.message, 'error', 9000);
    },
  });

  guardUnload(() => autosave.hasPending);

  /**
   * DB나 보정식이 바뀐 뒤 호출한다. 근거가 달라졌으므로 저장된 계산 결과는 더 이상 맞지 않는다.
   * 화면에 남겨두면 옛 근거로 결재가 올라갈 수 있어서, 과제를 새 엔진 기준으로 다시 맞추고
   * 결과는 "재계산 필요"로 되돌린다.
   */
  function invalidateResults() {
    const { project, projects } = store.get();
    store.set({
      projects: projects.map((p) => normalizeProject(engine, p)),
      project: project ? normalizeProject(engine, project) : null,
      plans: null,
      plansStale: true,
    });
    autosave.schedule();
    render();
  }

  /* ---------------------------- 컨텍스트 ---------------------------- */

  const ctx = {
    // 임포트 DB를 적용하면 엔진이 통째로 다시 만들어진다. 화면들은 그릴 때마다 여기서 꺼내 쓴다.
    get engine() {
      return engine;
    },
    get db() {
      return db;
    },
    get baseDb() {
      return baseDb;
    },
    get state() {
      return store.get();
    },
    get project() {
      return store.get().project;
    },
    subscribe: store.subscribe,

    /** 과제 속성 변경 → 자동저장 예약 */
    patchProject(patch) {
      const project = store.get().project;
      if (!project) return;
      const updated = { ...project, ...patch, updatedAt: new Date().toISOString() };
      store.set({ project: updated, projects: upsert(store.get().projects, updated) });
      autosave.schedule();
    },

    /** 라인업 한 줄 변경. 계산 결과는 즉시 "다시 계산 필요"로 표시된다. */
    patchItem(uid, patch) {
      const project = store.get().project;
      if (!project) return;
      const lineup = project.lineup.map((item) => (item.uid === uid ? { ...item, ...patch } : item));
      ctx.setLineup(lineup);
    },

    setLineup(lineup) {
      const project = store.get().project;
      if (!project) return;
      const updated = { ...project, lineup, updatedAt: new Date().toISOString() };
      store.set({ project: updated, projects: upsert(store.get().projects, updated), plansStale: true });
      autosave.schedule();
    },

    /**
     * 설계안 3종 계산. 입력이 유효하지 않으면 계산하지 않고 이유를 알린다.
     * (구버전은 목표 0인 상태로도 계산이 돌아 Infinity가 보고서까지 흘러갔다)
     */
    recalculate({ silent = false } = {}) {
      const project = store.get().project;
      if (!project) return null;
      const validation = validateLineup(engine, project.lineup);
      if (!validation.ok) {
        if (!silent) {
          toast(`입력을 먼저 완성해 주세요 — ${validation.blockedItems.join(', ')} (${validation.errorCount}건)`, 'warn', 6000);
        }
        store.set({ plansStale: true });
        return null;
      }
      const plans = engine.buildPlans(specsOf(project), project.objective, project.assumptions);
      store.set({ plans, plansStale: false });
      const selected = plans.find((p) => p.kind === project.selectedKind) || plans[1];
      ctx.patchProject({ resultSnapshot: selected, engineVersion: ENGINE_VERSION, dataVersion: db.meta?.sourceBuild });
      return plans;
    },

    get plans() {
      return store.get().plans;
    },
    get selectedPlan() {
      const { plans, project } = store.get();
      if (!plans) return null;
      return plans.find((p) => p.kind === project?.selectedKind) || plans[1];
    },

    selectPlan(kind) {
      ctx.patchProject({ selectedKind: kind, resultSnapshot: store.get().plans?.find((p) => p.kind === kind) || null });
      render();
    },

    openProject(project) {
      const normalized = normalizeProject(engine, project);
      store.set({ project: normalized, plans: null, plansStale: true, view: 'requirements' });
      ctx.recalculate({ silent: true });
      render();
      window.scrollTo(0, 0);
    },

    newProject() {
      const project = createProject(engine);
      store.set({ project, projects: [project, ...store.get().projects], plans: null, plansStale: true, view: 'requirements' });
      autosave.schedule();
      render();
      window.scrollTo(0, 0);
    },

    async deleteProject(id) {
      const target = store.get().projects.find((p) => p.id === id);
      const confirmed = await confirmAction({
        title: '과제를 삭제할까요?',
        message: `"${target?.name}" 과제와 저장된 결과가 이 브라우저에서 지워집니다. 되돌릴 수 없습니다.`,
        confirmLabel: '삭제',
        danger: true,
      });
      if (!confirmed) return;
      const projects = store.get().projects.filter((p) => p.id !== id);
      const current = store.get().project;
      store.set({ projects, project: current?.id === id ? null : current, view: 'workbench' });
      autosave.schedule();
      autosave.flush();
      toast('과제를 삭제했습니다.', 'info');
      render();
    },

    saveNow() {
      const result = autosave.flush();
      if (result.ok) toast('저장했습니다.', 'success', 2200);
    },

    goto(view) {
      autosave.flush();
      store.set({ view, sidebarOpen: false });
      render();
      window.scrollTo(0, 0);
    },

    setProjects(projects) {
      store.set({ projects });
      autosave.schedule();
    },

    /**
     * 임포트 DB를 적용/해제한다. overlay 가 null 이면 내장 DB로 되돌린다.
     *
     * DB가 바뀌면 기존 계산 결과는 근거가 달라진 값이므로 신뢰할 수 없다. 화면에 남겨두면
     * 사용자가 옛 근거로 결재를 올릴 수 있어서, 저장된 과제는 새 DB 기준으로 다시 맞추고
     * 계산 결과는 "재계산 필요"로 되돌린다.
     *
     * @returns {{ok:true} | {ok:false, message:string}}
     */
    setDbOverlay(next) {
      const saved = next ? saveOverlay(next) : (clearOverlay(), { ok: true });
      if (!saved.ok) return saved;
      overlay = next;
      rebuildEngine();
      invalidateResults();
      return { ok: true };
    },

    get calibration() {
      return calibration;
    },

    /**
     * 보정 데이터를 갈아끼운다. 승인 상태가 바뀌면 예측값 자체가 달라지므로
     * DB를 바꿀 때와 똑같이 저장된 계산 결과를 "재계산 필요"로 되돌린다.
     * @returns {{ok:true} | {ok:false, message:string}}
     */
    setCalibration(next) {
      const saved = saveCalibration(next);
      if (!saved.ok) return saved;
      const wasActive = JSON.stringify(activeCalibrationModels(calibration));
      calibration = next;
      const isActive = JSON.stringify(activeCalibrationModels(calibration));
      if (wasActive === isActive) {
        // 표본만 늘었을 뿐 예측에 쓰이는 식은 그대로 — 결과를 무효화할 이유가 없다.
        render();
        return { ok: true };
      }
      rebuildEngine();
      invalidateResults();
      return { ok: true };
    },

    render: () => render(),
    toast,
    confirmAction,
  };

  const upsert = (projects, project) => [project, ...projects.filter((p) => p.id !== project.id)];

  /* ---------------------------- 셸 렌더 ---------------------------- */

  const sidebar = h('aside.sidebar');
  const topbar = h('header.topbar');
  const main = h('main.view-area');
  const shell = h('div.app-shell', null, sidebar, h('div.main-shell', null, topbar, main));
  clear(root).append(shell);

  function renderSidebar() {
    const { view, project, sidebarOpen } = store.get();
    shell.classList.toggle('sidebar-open', sidebarOpen);

    const nav = h('nav', { 'aria-label': '주 메뉴' });
    for (const item of VIEWS) {
      if (item.section) nav.append(h('p.nav-label', null, item.section));
      const button = h(
        `button.nav-item${view === item.id ? '.active' : ''}`,
        {
          type: 'button',
          'aria-current': view === item.id ? 'page' : null,
          disabled: !project && !PROJECTLESS_VIEWS.has(item.id),
          onclick: () => ctx.goto(item.id),
        },
        icon(item.icon, 17),
        h('span', null, item.label),
      );
      nav.append(button);
    }

    const usage = storageUsage();
    clear(sidebar).append(
      h(
        'div.brand',
        null,
        h('div.brand-mark', null, icon('layers', 20)),
        h('div', null, h('strong', null, 'Battery Design Studio'), h('span', null, 'v8 · 설계 워크벤치')),
        h('button.mobile-close', { type: 'button', 'aria-label': '메뉴 닫기', onclick: () => { store.set({ sidebarOpen: false }); renderSidebar(); } }, icon('x', 18)),
      ),
      nav,
      project &&
        h(
          'div.sidebar-project',
          null,
          h('span', null, '진행 중 과제'),
          h('strong', null, project.name),
          h('small', null, `${project.lineup.length}개 제품 · ${STATUS_LABEL[project.status]}`),
          h('p', null, `마지막 수정 ${dateLabel(project.updatedAt)}`),
        ),
      h(
        'div.sidebar-footer',
        null,
        h(
          'div',
          null,
          h('strong', null, `DB ${engine.dbStats.references}건 · 극판 ${engine.dbStats.plates}건`),
          h('span', null, `데이터 ${baseDb.meta?.sourceBuild || '—'}`),
        ),
      ),
      // 지금 보고 있는 숫자가 내장 DB 기준인지 임포트 DB 기준인지는 항상 보여야 한다.
      db.overlay &&
        h(
          'p.sidebar-overlay',
          { title: `${db.overlay.baseProducts}건 → ${engine.dbStats.references}건` },
          `임포트 DB 적용 중 · ${dateLabel(db.overlay.importedAt)}`,
        ),
      // 보정이 걸린 예측인지 아닌지는 숫자를 읽는 사람이 반드시 알아야 한다.
      engine.calibration &&
        h(
          'p.sidebar-calibration',
          { title: Object.keys(engine.calibration).join(', ') },
          `예측 보정 ${Object.keys(engine.calibration).length}개 지표 적용 중`,
        ),
      db.masked && h('p.sidebar-masked', null, '시연용 마스킹 데이터'),
    );
  }

  function renderTopbar() {
    const { view, project, saveState, plansStale } = store.get();
    const current = VIEWS.find((v) => v.id === view);

    const saveBadge = h(
      `span.save-indicator.${saveState.state}`,
      { title: saveState.message || '' },
      saveState.state === 'dirty' ? '● 변경사항 있음' : saveState.label,
    );

    clear(topbar).append(
      h('button.mobile-menu', { type: 'button', 'aria-label': '메뉴 열기', onclick: () => { store.set({ sidebarOpen: true }); renderSidebar(); } }, icon('layers', 20)),
      h(
        'div.breadcrumb',
        null,
        h('span', null, '제품개발'),
        h('span', null, '›'),
        h('strong', null, current?.label || ''),
        project && h('span.crumb-project', null, `· ${project.name}`),
      ),
      h(
        'div.topbar-tools',
        null,
        plansStale && project && h('span.stale-badge', { title: '입력이 바뀌었습니다. 다시 계산해야 결과가 맞습니다.' }, '재계산 필요'),
        saveBadge,
        project && h('button.icon-button', { type: 'button', title: '지금 저장', onclick: () => ctx.saveNow() }, icon('save', 17)),
        h('button.icon-button', { type: 'button', title: '도움말 (F1)', 'aria-label': '도움말 열기', onclick: openHelp }, icon('help', 17)),
      ),
    );
  }

  function renderView() {
    const { view, project } = store.get();
    const renderer = RENDERERS[view] || renderWorkbench;
    if (!project && !PROJECTLESS_VIEWS.has(view)) {
      clear(main).append(renderWorkbench(ctx));
      return;
    }
    clear(main).append(renderer(ctx));
  }

  function render() {
    renderSidebar();
    renderTopbar();
    renderView();
  }

  /* ---------------------------- 도움말 ---------------------------- */

  function openHelp() {
    const view = store.get().view;
    const current = HELP[view] || HELP.workbench;
    const list = (items) => h('ul', null, items.map((tip) => h('li', null, tip)));
    openModal({
      eyebrow: 'BATTERY DESIGN STUDIO · 도움말',
      title: current.title,
      body: h(
        'div.help-body',
        null,
        h('div.help-current', null, list(current.tips)),
        h('h4', null, '다른 화면'),
        ...Object.entries(HELP)
          .filter(([key]) => key !== view)
          .map(([, value]) => h('details', null, h('summary', null, value.title), list(value.tips))),
        h('details', null, h('summary', null, '공통 안내'), list(HELP.common.tips)),
        h(
          'p.help-note',
          null,
          '이 도구는 설계 검토를 돕습니다. 시제품 시험·패킹 검증·Gate 승인을 대체하지 않습니다. 케이스 도면 호환성은 별도로 확인해야 합니다.',
        ),
      ),
    });
  }

  // F1로도 도움말을 연다. 브라우저 기본 도움말은 막는다.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F1') {
      event.preventDefault();
      openHelp();
    }
  });

  // 저장 상태 배지와 재계산 배지는 상단바만 다시 그리면 된다.
  store.subscribe((_, changed) => {
    if (changed.has('saveState') || changed.has('plansStale')) renderTopbar();
  });

  render();
  return ctx;
}
