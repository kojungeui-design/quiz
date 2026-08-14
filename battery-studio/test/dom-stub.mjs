/**
 * test/dom-stub.mjs — node에서 화면 코드를 실행하기 위한 최소 DOM.
 *
 * 브라우저를 띄우지 않고도 "화면을 그리다가 터지는" 오류(오타·없는 함수·잘못된 속성)를
 * 잡기 위한 것이다. 렌더링 정확도를 흉내내지는 않는다.
 */

class ClassList {
  constructor(node) {
    this.node = node;
    this.set = new Set();
  }
  add(...names) { names.filter(Boolean).forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const shouldHave = force === undefined ? !this.set.has(name) : !!force;
    if (shouldHave) this.set.add(name);
    else this.set.delete(name);
    return shouldHave;
  }
  get value() { return [...this.set].join(' '); }
}

class StubNode {
  constructor(tag = '#node') {
    this.tagName = String(tag).toUpperCase();
    this.tag = tag;
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this.parentNode = null;
    this._text = '';
  }

  get children() { return this.childNodes.filter((c) => c instanceof StubNode); }
  get firstChild() { return this.childNodes[0] || null; }

  append(...nodes) {
    for (const node of nodes.flat()) {
      if (node === null || node === undefined) continue;
      const child = node instanceof StubNode || node instanceof StubText ? node : new StubText(String(node));
      child.parentNode = this;
      if (child instanceof StubFragment) {
        for (const grandchild of child.childNodes) {
          grandchild.parentNode = this;
          this.childNodes.push(grandchild);
        }
      } else {
        this.childNodes.push(child);
      }
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((f) => f !== fn));
  }
  /** 테스트에서 클릭·입력을 흉내낼 때 쓴다. */
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 20 }; }
  contains() { return true; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }

  get textContent() {
    if (this._text) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    this.childNodes = [];
    this._text = String(value);
  }
  set className(value) {
    this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this.classList.value; }

  /** 트리 전체의 텍스트를 모아 검증에 쓴다. */
  allText() { return this.textContent; }
  /** 특정 클래스를 가진 자손을 모두 찾는다(테스트 편의). */
  findAll(predicate, found = []) {
    for (const child of this.children) {
      if (predicate(child)) found.push(child);
      child.findAll(predicate, found);
    }
    return found;
  }
}

class StubText extends StubNode {
  constructor(text) {
    super('#text');
    this._text = String(text);
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
}

class StubFragment extends StubNode {
  constructor() { super('#fragment'); }
}

export function installDomStub() {
  const body = new StubNode('body');
  const root = new StubNode('div');
  root.attributes.id = 'app';
  body.append(root);

  const documentListeners = new Map();
  const store = new Map();

  const document = {
    body,
    documentElement: new StubNode('html'),
    readyState: 'complete',
    activeElement: null,
    createElement: (tag) => new StubNode(tag),
    createElementNS: (_ns, tag) => new StubNode(tag),
    createTextNode: (text) => new StubText(text),
    createDocumentFragment: () => new StubFragment(),
    getElementById: (id) => (id === 'app' ? root : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((f) => f !== fn));
    },
    dispatch: (type, event) => {
      for (const fn of documentListeners.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, ...event });
    },
  };

  globalThis.Node = StubNode;
  globalThis.document = document;
  globalThis.window = globalThis;
  globalThis.HTMLElement = StubNode;
  globalThis.scrollTo = () => {};
  globalThis.print = () => {};
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
    clear: () => store.clear(),
  };
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};
  if (!globalThis.addEventListener) globalThis.addEventListener = () => {};

  return { document, root, body, storage: store };
}

export { StubNode, StubText };
