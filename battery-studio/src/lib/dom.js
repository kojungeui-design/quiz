/**
 * src/lib/dom.js — 최소 DOM 헬퍼.
 *
 * 프레임워크를 쓰지 않는 이유: 이 앱은 폼과 표가 전부다. 가상 DOM이 주는 이득보다
 * 400KB 런타임과 빌드 체인이 주는 부담이 크다.
 *
 * 설계 원칙 하나: 문자열을 innerHTML로 밀어넣지 않는다. 모든 텍스트는 textContent로만
 * 들어가므로 DB에 어떤 값이 있어도 스크립트로 해석될 여지가 없다.
 */

/** 'div.card.wide' → { tag:'div', classes:['card','wide'] } */
function parseSelector(selector) {
  const [tag, ...classes] = String(selector).split('.');
  return { tag: tag || 'div', classes };
}

/**
 * 엘리먼트 생성.
 *   h('div.card', { onclick }, '텍스트', h('span', null, '자식'))
 *
 * props 중 on으로 시작하는 키는 이벤트 리스너, 나머지는 속성/프로퍼티다.
 * null·undefined·false 자식은 건너뛰므로 `조건 && h(...)` 패턴을 그대로 쓸 수 있다.
 */
export function h(selector, props, ...children) {
  const { tag, classes } = parseSelector(selector);
  const node = document.createElement(tag);
  if (classes.length) node.classList.add(...classes);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key === 'class') {
        node.classList.add(...String(value).split(/\s+/).filter(Boolean));
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key === 'dataset') {
        Object.assign(node.dataset, value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
        node[key] = value;
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** 자주 쓰는 축약들 */
export const text = (selector, value, props) => h(selector, props, value);
export const frag = (...children) => append(document.createDocumentFragment(), children);

/** 인라인 SVG 아이콘. lucide 아이콘의 path만 옮겨왔다. */
const ICON_PATHS = {
  layers: ['M12 2 2 7l10 5 10-5-10-5Z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  coins: ['M12 14a6 4 0 1 0 0-8 6 4 0 0 0 0 8Z', 'M6 10v4c0 2.2 2.7 4 6 4s6-1.8 6-4v-4', 'M6 14v4c0 2.2 2.7 4 6 4s6-1.8 6-4v-4'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v5h5', 'M9 13h6', 'M9 17h6'],
  database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  check: ['m5 12 5 5L20 7'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  copy: ['M4 16V4a2 2 0 0 1 2-2h10', 'M8 6h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
  trash: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  arrowLeft: ['M19 12H5', 'm12 19-7-7 7-7'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
};

export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * 가로 스크롤이 필요한 표를 감싼다.
 * 표를 그대로 두면 페이지 전체가 가로로 밀려 모바일에서 못 쓴다.
 */
export const scrollable = (node) => h('div.table-scroll', null, node);

/**
 * 표 생성기. columns = [{ key, label, align, format }]
 */
export function table(columns, rows, options = {}) {
  const thead = h(
    'thead',
    null,
    h('tr', null, columns.map((c) => h('th', { class: c.align === 'right' ? 'right' : null }, c.label))),
  );
  const tbody = h(
    'tbody',
    null,
    rows.map((row, index) =>
      h(
        'tr',
        { class: options.rowClass ? options.rowClass(row, index) : null },
        columns.map((c) => {
          const value = c.format ? c.format(row, index) : row[c.key];
          return h('td', { class: c.align === 'right' ? 'right' : null }, value);
        }),
      ),
    ),
  );
  return scrollable(h('table.data-table', null, thead, tbody));
}

/** 모달: Esc 닫기, 포커스 트랩, 배경 스크롤 잠금까지 한 곳에서 처리한다. */
export function openModal({ title, eyebrow, body, onClose }) {
  const closeButton = h('button.modal-close', { type: 'button', 'aria-label': '닫기' }, icon('x', 18));
  const panel = h(
    'div.modal-panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header.modal-head', null, h('div', null, eyebrow && h('small', null, eyebrow), h('h2', null, title)), closeButton),
    h('div.modal-body', null, body),
  );
  const overlay = h('div.modal-overlay', null, panel);

  const previouslyFocused = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    document.body.classList.remove('modal-open');
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    onClose?.();
  };
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown, true);
  document.body.classList.add('modal-open');
  document.body.append(overlay);
  closeButton.focus();
  return { close, panel };
}
