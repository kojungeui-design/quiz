/**
 * src/lib/store.js — 상태 저장소와 토스트.
 *
 * 상태 변경 → 구독자 통지가 전부다. 화면 전체를 다시 그리지 않고,
 * 값이 바뀐 자리만 각 뷰가 직접 갱신한다. 입력 중 포커스가 튀지 않는 게 이 방식의 핵심 이득이다.
 */
import { h } from './dom.js';

export function createStore(initialState) {
  let state = initialState;
  const subscribers = new Set();

  const notify = (changedKeys) => {
    for (const fn of [...subscribers]) {
      try {
        fn(state, changedKeys);
      } catch (error) {
        console.error('[store] 구독자 오류', error);
      }
    }
  };

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      notify(new Set(Object.keys(patch)));
    },
    update(fn) {
      const patch = fn(state);
      if (patch) this.set(patch);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

/* ============================== 토스트 알림 ============================== */

const TOAST_ICONS = { info: 'ℹ', warn: '⚠', error: '✕', success: '✓' };
let toastWrap = null;

/**
 * 알림을 띄운다. 종류(type)는 호출하는 쪽이 명시한다.
 * 구버전은 메시지 문구를 정규식으로 뒤져 심각도를 추측했는데, 문구를 고칠 때마다 오분류가 났다.
 */
export function toast(message, type = 'info', duration = 4200) {
  if (!toastWrap || !document.body.contains(toastWrap)) {
    toastWrap = h('div.toast-wrap', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastWrap);
  }
  const node = h(
    `div.toast.${type}`,
    null,
    h('span.toast-icon', null, TOAST_ICONS[type] || TOAST_ICONS.info),
    h('span.toast-message', null, String(message)),
  );
  const closeButton = h('button.toast-close', { type: 'button', 'aria-label': '알림 닫기' }, '×');
  const dismiss = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 180);
  };
  closeButton.addEventListener('click', dismiss);
  node.append(closeButton);

  toastWrap.append(node);
  while (toastWrap.children.length > 4) toastWrap.firstChild.remove();
  if (duration > 0) setTimeout(dismiss, duration);
  return { dismiss };
}

/** 되돌릴 수 없는 작업 확인. 네이티브 confirm은 쓰지 않는다(스타일·포커스 제어 불가). */
export function confirmAction({ title, message, confirmLabel = '진행', danger = false }) {
  return new Promise((resolve) => {
    // dom.js의 openModal을 쓰면 순환 참조가 되므로 여기서 간단히 구성한다.
    const overlay = h('div.modal-overlay.confirm');
    const cancel = h('button.secondary-button', { type: 'button' }, '취소');
    const ok = h(`button.primary-button${danger ? '.danger' : ''}`, { type: 'button' }, confirmLabel);
    const panel = h(
      'div.modal-panel.small',
      { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.modal-body', null, h('h3', null, title), h('p', null, message), h('div.modal-actions', null, cancel, ok)),
    );
    overlay.append(panel);

    const finish = (value) => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      document.body.classList.remove('modal-open');
      resolve(value);
    };
    function onKeydown(event) {
      if (event.key === 'Escape') finish(false);
    }
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKeydown, true);
    document.body.classList.add('modal-open');
    document.body.append(overlay);
    ok.focus();
  });
}
